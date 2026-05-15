/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import logger from '../logger.js';
import { bus } from '../events/event-bus.js';
import * as jobStorage from '../storage/jobStorage.js';
import * as userStorage from '../storage/userStorage.js';
import { getUser } from '../storage/userStorage.js';
import { duringWorkingHoursOrNotSet } from '../../utils.js';
import FredyPipelineExecutioner from '../../FredyPipelineExecutioner.js';
import * as similarityCache from '../similarity-check/similarityCache.js';
import { isRunning, markFinished, markRunning } from './run-state.js';
import { sendToUsers } from '../sse/sse-broker.js';
import * as browserPool from '../extractor/browserPool.js';

/**
 * Initializes the job execution service.
 * - Registers event-bus listeners for `jobs:runAll`, `jobs:runOne`, and `jobs:status`.
 * - Starts individual timers for each job based on their configured intervals.
 * - Forwards job status updates to affected users via Server-Sent Events (SSE).
 *
 * This function is intentionally side-effectful and exposes no external API.
 *
 * @param {Object} deps - Dependencies required to initialize the service.
 * @param {Array<Object>} deps.providers - Loaded provider modules. Each module must expose `metaInformation.id`, `config`, and `init(config, blacklist)`.
 * @param {Object} deps.settings - Global settings object (read/write). Must include `demoMode`, `interval`, and working-hours attributes used by `duringWorkingHoursOrNotSet`.
 * @param {number} deps.intervalMs - Global scheduler interval in milliseconds. Used as default for jobs without a specific interval.
 * @returns {void}
 */
export function initJobExecutionService({ providers, settings, intervalMs }) {
  // Track active timers for each job
  const jobTimers = new Map();
  // Forward job status via SSE to relevant recipients
  bus.on('jobs:status', ({ jobId, running }) => {
    try {
      const recipients = resolveRecipients(jobId);
      if (recipients.length > 0) {
        sendToUsers(recipients, 'jobStatus', { jobId, running });
      }
    } catch (err) {
      logger.warn('Failed to forward job status', jobId, err);
    }
  });

  // Listen for "run all" requests (admin = all, user = own)
  bus.on('jobs:runAll', (payload) => {
    const userId = payload?.userId ?? null;
    const user = userId ? getUser(userId) : null;
    const isAdmin = !!user?.isAdmin;
    if (isAdmin) {
      logger.debug('Running all jobs manually (admin request)');
    } else if (userId) {
      logger.debug(`Running all jobs manually for user ${userId}`);
    } else {
      logger.debug('Running all jobs manually (no user provided)');
    }
    runAll(false, { userId, isAdmin });
  });

  // Listen for single job run requests
  bus.on('jobs:runOne', ({ jobId }) => {
    logger.debug(`Running single job manually: ${jobId}`);
    // fire and forget, do not block the bus
    runSingle(jobId);
  });

  // Listen for job changes (created/updated/deleted) to restart timers
  bus.on('jobs:changed', () => {
    logger.debug('Jobs changed, restarting timers');
    startJobTimers();
  });

  // Start individual timers for each job and perform initial run
  startJobTimers();
  // start once at startup, respecting working hours
  runAll(true);

  /**
   * Start individual interval timers for each enabled job.
   * Each job runs on its own schedule based on its intervalMinutes or the global interval.
   * @returns {void}
   */
  function startJobTimers() {
    if (settings.demoMode) return;

    // Clear existing timers
    for (const timer of jobTimers.values()) {
      clearInterval(timer);
    }
    jobTimers.clear();

    const jobs = jobStorage.getJobs().filter((job) => job.enabled);

    for (const job of jobs) {
      const jobIntervalMs = job.intervalMinutes != null ? job.intervalMinutes * 60 * 1000 : intervalMs;

      if (Number.isFinite(jobIntervalMs) && jobIntervalMs > 0) {
        const timer = setInterval(async () => {
          if (settings.demoMode) return;
          const withinHours = duringWorkingHoursOrNotSet(settings, Date.now());
          if (!withinHours) {
            logger.debug(`Working hours set. Skipping job ${job.id} as outside of working hours.`);
            return;
          }
          await executeJob(job);
        }, jobIntervalMs);

        jobTimers.set(job.id, timer);
        logger.debug(
          `Started timer for job ${job.id} with interval ${jobIntervalMs}ms (${job.intervalMinutes ?? intervalMs / 60000} minutes)`,
        );
      }
    }
  }

  /**
   * Resolve all recipients who should receive SSE updates for a job.
   * Includes job owner, users with whom the job is shared, and all admins.
   *
   * @param {string} jobId
   * @returns {string[]} unique userIds
   */
  function resolveRecipients(jobId) {
    const job = jobStorage.getJob(jobId);
    if (!job) return [];
    const admins = (userStorage.getUsers && userStorage.getUsers(false)) || [];
    const adminIds = admins.filter((u) => u.isAdmin).map((u) => u.id);
    const shared = Array.isArray(job.shared_with_user) ? job.shared_with_user : [];
    const recipients = [job.userId, ...shared, ...adminIds].filter(Boolean);
    return Array.from(new Set(recipients));
  }

  /**
   * Execute all enabled jobs, optionally filtering by context (admin/owner) and respecting working hours.
   *
   * @param {boolean} [respectWorkingHours=true] - If true, skip execution when outside configured working hours.
   * @param {{userId?: string, isAdmin?: boolean}} [context] - Who requested the run; determines job filtering.
   * @returns {void}
   */
  async function runAll(respectWorkingHours = true, context = undefined) {
    if (settings.demoMode) return;
    const now = Date.now();
    const withinHours = duringWorkingHoursOrNotSet(settings, now);
    if (respectWorkingHours && !withinHours) {
      logger.debug('Working hours set. Skipping as outside of working hours.');
      return;
    }
    settings.lastRun = now;
    const jobs = jobStorage
      .getJobs()
      .filter((job) => job.enabled)
      .filter((job) => {
        if (!context) return true; // startup/cron → all
        if (context.isAdmin) return true; // admin → all
        return context.userId ? job.userId === context.userId : false; // user → own
      });

    for (const job of jobs) {
      await executeJob(job);
    }
  }

  /**
   * Execute a single job by id.
   * Manual runs are allowed even if the job is disabled, but never duplicated when already running.
   * Manual runs skip jitter for immediate execution.
   *
   * @param {string} jobId
   * @returns {Promise<void>}
   */
  async function runSingle(jobId) {
    if (settings.demoMode) return;
    const job = jobStorage.getJob(jobId);
    if (!job) return;
    // allow manual run even if disabled; skip jitter for immediate execution
    await executeJob(job, true);
  }

  /**
   * Calculate a safe random jitter delay that will not collide with the next scheduled run.
   *
   * @param {number} intervalMs - The job's execution interval in milliseconds.
   * @param {number} [jitterPercent=20] - Maximum jitter as percentage of interval (0-50).
   * @returns {number} Random jitter delay in milliseconds.
   */
  function calculateSafeJitter(intervalMs, jitterPercent = 20) {
    // Cap jitter at 50% to ensure we never approach next scheduled run
    const safeLimitPercent = Math.min(Math.max(jitterPercent, 0), 50);
    return Math.floor(Math.random() * intervalMs * (safeLimitPercent / 100));
  }

  /**
   * Executes one job across all of its configured providers.
   * Emits SSE start/finish events via the bus and ensures the run-state guard is always cleared.
   * Provider errors are surfaced via logging but do not abort other providers.
   *
   * @param {Object} job
   * @param {string} job.id
   * @param {Array<{id:string}>} job.provider
   * @param {Array<string>} [job.blacklist]
   * @param {*} job.notificationAdapter
   * @param {number} [job.jitterPercent] Maximum jitter as percentage of interval (0-50, default: 20).
   * @param {boolean} [skipJitter=false] Skip jitter delay (for manual runs).
   * @returns {Promise<void>}
   */
  async function executeJob(job, skipJitter = false) {
    if (isRunning(job.id)) {
      logger.debug(`Job ${job.id} is already running. Skipping.`);
      return;
    }

    // Apply jitter delay before execution to randomize timing and avoid detection patterns
    if (!skipJitter) {
      const jobIntervalMs = job.intervalMinutes != null ? job.intervalMinutes * 60 * 1000 : intervalMs;
      const jitterPercent = job.jitterPercent ?? 20;
      const jitterMs = calculateSafeJitter(jobIntervalMs, jitterPercent);

      if (jitterMs > 0) {
        logger.debug(
          `Job ${job.id} applying jitter delay of ${Math.round(jitterMs / 1000)}s (${jitterPercent}% of ${Math.round(jobIntervalMs / 60000)}min interval)`,
        );
        await new Promise((resolve) => setTimeout(resolve, jitterMs));
      }
    }

    const acquired = markRunning(job.id);
    if (!acquired) return;
    // notify listeners (SSE) that the job started
    try {
      bus.emit('jobs:status', { jobId: job.id, running: true });
    } catch (err) {
      logger.warn('Failed to emit start status for job', job.id, err);
    }
    let browser;
    let browserAcquired = false;
    try {
      const jobProviders = job.provider.filter(
        (p) => providers.find((loaded) => loaded.metaInformation.id === p.id) != null,
      );
      for (const prov of jobProviders) {
        try {
          const matchedProvider = providers.find((loaded) => loaded.metaInformation.id === prov.id);
          matchedProvider.init({ ...prov, userId: job.userId }, job.blacklist);

          if (!browser && matchedProvider.config.getListings == null) {
            browser = await browserPool.acquireBrowser(matchedProvider.config.url, { headless: false });
            browserAcquired = true;
          }

          await new FredyPipelineExecutioner(matchedProvider.config, job, prov.id, similarityCache, browser).execute();
        } catch (err) {
          logger.error(err);
        }
      }
    } finally {
      if (browserAcquired) {
        await browserPool.releaseBrowser();
      }
      markFinished(job.id);
      try {
        bus.emit('jobs:status', { jobId: job.id, running: false });
      } catch (err) {
        logger.warn('Failed to emit finish status for job', job.id, err);
      }
    }
  }
}
