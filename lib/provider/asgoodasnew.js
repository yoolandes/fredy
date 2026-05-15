/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { isOneOf } from '../utils.js';
import { extractNumber } from '../utils/extract-number.js';

let appliedBlackList = [];

function normalize(o) {
  const match = o.title.match(/\/([^/]+)\.html.*$/);
  const title = match ? match[1] : o.title;
  return {
    ...o,
    price: extractNumber(o.price),
    title: title,
  };
}

//apply blacklist if needed
function applyBlacklist(o) {
  const titleNotBlacklisted = !isOneOf(o.title, appliedBlackList);
  const descNotBlacklisted = !isOneOf(o.description, appliedBlackList);

  return titleNotBlacklisted && descNotBlacklisted;
}

const config = {
  requiredFieldNames: ['id', 'link', 'price'],
  url: null,
  crawlContainer: '.conditions-condition:not(.condition--outofstock)',
  crawlFields: {
    id: '@data-selection-id',
    price: '.conditions--newprice | trim',
    link: '@data-article-link',
    title: '@data-article-link',
  },
  normalize: normalize,
  filter: applyBlacklist,
};

export const metaInformation = {
  name: 'asgoodasnew',
  baseUrl: 'https://asgoodasnew.de/',
  id: 'asgoodasnew',
};

export const init = (sourceConfig, blacklist) => {
  config.enabled = sourceConfig.enabled;
  config.url = sourceConfig.url;
  appliedBlackList = blacklist || [];
};

export { config };
