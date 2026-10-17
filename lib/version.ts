import pkg from '../package.json';

/** Single source of truth for the displayed version: package.json "version". */
export const APP_VERSION = `v${pkg.version}`;
