// Local, empty PostCSS config for apps/web (plain CSS, no Tailwind here).
// Needed so Next's postcss-loader stops walking up the directory tree and
// picking up the repo root's postcss.config.js instead — that file is ESM
// (root package.json has "type": "module") and Next's webpack pipeline
// loads postcss configs via require(), so the ESM `export default` gets
// wrapped as `{ default: {...} }` and its `plugins` key is invisible to
// postcss-loader, which then fails with "must export a `plugins` key."
module.exports = {
  plugins: {},
};
