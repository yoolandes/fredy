import { isOneOf } from '../utils.js';
import { extractNumber } from '../utils/extract-number.js';

let appliedBlackList = [];

function normalize(o) {
  return {
    ...o,
    price: extractNumber(o.price),
  };
}

//apply blacklist if needed
function applyBlacklist(o) {
  const titleNotBlacklisted = !isOneOf(o.title, appliedBlackList);
  const descNotBlacklisted = !isOneOf(o.description, appliedBlackList);

  return titleNotBlacklisted && descNotBlacklisted;
}

const config = {
  requiredFieldNames: ['id', 'link', 'title', 'price', 'image'],
  url: null,
  crawlContainer: '.srp-results .s-card',
  crawlFields: {
    id: '@id',
    price: '.s-card__price | trim',
    title: '.s-card__title .default',
    link: 'a.s-card__link@href',
    image: 'img@src',
  },
  normalize: normalize,
  filter: applyBlacklist,
};

export const metaInformation = {
  name: 'ebay',
  baseUrl: 'https://www.ebay.de/',
  id: 'ebay',
};

export const init = (sourceConfig, blacklist) => {
  config.enabled = sourceConfig.enabled;
  config.url = sourceConfig.url;
  appliedBlackList = blacklist || [];
};

export { config };
