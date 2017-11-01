/* eslint-env node */
'use strict';

module.exports = {
  name: 'ember-m3',

  options: {
    babel: {
      loose: true,
      plugins: [
        ['ember-modules-api-polyfill', { blacklist: { '@ember/debug': ['assert', 'deprecate', 'warn']} }],
      ]
    },
  },
};
