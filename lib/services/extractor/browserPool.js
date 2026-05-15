/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { launchBrowser, closeBrowser } from './puppeteerExtractor.js';

const IDLE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

let currentBrowser = null;
let isAcquired = false;
let idleTimer = null;
const queue = [];

/**
 * Acquire a browser instance from the pool.
 * Only one browser can be acquired at a time; subsequent calls will wait in queue.
 *
 * @param {string} url - URL to initialize browser context
 * @param {object} [options] - Browser launch options
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
export async function acquireBrowser(url, options) {
  // If browser is currently acquired, queue this request
  if (isAcquired) {
    await new Promise((resolve) => {
      queue.push(resolve);
    });
  }

  isAcquired = true;

  // Clear idle timeout since browser is being used
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  // Check if existing browser is disconnected
  if (currentBrowser && !currentBrowser.isConnected()) {
    currentBrowser = null;
  }

  if (!currentBrowser) {
    currentBrowser = await launchBrowser(url, options);
  }

  return currentBrowser;
}

/**
 * Release a browser instance back to the pool.
 * The browser is not immediately closed to allow reuse.
 * Starts an idle timeout that will close the browser after 2 minutes of inactivity.
 *
 * @returns {Promise<void>}
 */
export async function releaseBrowser() {
  isAcquired = false;

  // Start idle timeout if no jobs are queued
  if (queue.length === 0) {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(async () => {
      if (currentBrowser && !isAcquired) {
        await closeBrowser(currentBrowser);
        currentBrowser = null;
        idleTimer = null;
      }
    }, IDLE_TIMEOUT_MS);
  }

  // Resolve next in queue
  if (queue.length > 0) {
    const nextResolve = queue.shift();
    nextResolve();
  }
}

/**
 * Close the browser pool and cleanup all resources.
 * Should be called during application shutdown.
 *
 * @returns {Promise<void>}
 */
export async function closePool() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (currentBrowser) {
    await closeBrowser(currentBrowser);
    currentBrowser = null;
  }
  isAcquired = false;
  queue.length = 0;
}
