/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as browserPool from '../../lib/services/extractor/browserPool.js';

describe('browserPool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await browserPool.closePool();
  });

  describe('tracer bullet: basic acquire and release', () => {
    it('should acquire a browser and release it', async () => {
      const browser = await browserPool.acquireBrowser('https://example.com', {});

      expect(browser).toBeDefined();
      expect(typeof browser.close).toBe('function');
      expect(typeof browser.isConnected).toBe('function');

      await browserPool.releaseBrowser();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('FIFO queue: second acquire waits for first release', () => {
    it('should queue second acquire until first is released', async () => {
      const events = [];

      // Job A acquires browser
      const promiseA = browserPool.acquireBrowser('https://example.com', {}).then((browser) => {
        events.push('A-acquired');
        return browser;
      });

      await promiseA;

      // Job B tries to acquire (should queue)
      const promiseB = browserPool.acquireBrowser('https://example.com', {}).then((browser) => {
        events.push('B-acquired');
        return browser;
      });

      // Give B a chance to try acquiring
      await new Promise((r) => setTimeout(r, 50));

      // B should NOT have acquired yet
      expect(events).toEqual(['A-acquired']);

      // Release A
      await browserPool.releaseBrowser();
      events.push('A-released');

      // Now B should acquire
      await promiseB;
      expect(events).toEqual(['A-acquired', 'A-released', 'B-acquired']);

      await browserPool.releaseBrowser();
    });
  });

  describe('browser reuse: released browser is reused', () => {
    it('should reuse the same browser instance after release', async () => {
      const browser1 = await browserPool.acquireBrowser('https://example.com', {});
      await browserPool.releaseBrowser();

      const browser2 = await browserPool.acquireBrowser('https://example.com', {});
      await browserPool.releaseBrowser();

      // Should be the same instance (not closed and reopened)
      expect(browser1).toBe(browser2);
    });
  });

  describe('idle timeout: browser closes after 2 minutes of inactivity', () => {
    it.skip('should close browser after 2 minutes idle', async () => {
      // TODO: Test with mocked timers - current implementation uses real browser
      // which doesn't play well with vi.useFakeTimers()
    });
  });

  describe('disconnection handling: creates new browser if disconnected', () => {
    it('should launch new browser if previous one disconnected', async () => {
      const browser1 = await browserPool.acquireBrowser('https://example.com', {});
      await browserPool.releaseBrowser();

      // Simulate disconnect by closing browser externally
      await browser1.close();

      const browser2 = await browserPool.acquireBrowser('https://example.com', {});
      await browserPool.releaseBrowser();

      // Should be a different instance
      expect(browser1).not.toBe(browser2);
      expect(browser2.isConnected()).toBe(true);
    });
  });
});
