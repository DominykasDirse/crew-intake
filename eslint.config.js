// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');

// A Zustand selector runs inside useSyncExternalStore's getSnapshot. If it returns a value
// built fresh on every call (array/object literal, filter/map/sort, a derive helper), React
// sees a changed snapshot each render and loops: "The result of getSnapshot should be
// cached" → "Maximum update depth exceeded". Select a raw slice and useMemo the derivation,
// or wrap the selector in useShallow. This rule fails the lint on the shapes that do it.
const STORE_HOOKS = '/^use(Uploads|Outbox|Local|Session)$/';
const FRESH_BODY =
  ':matches(ArrayExpression, ObjectExpression, NewExpression, ' +
  'CallExpression[callee.property.name=/^(filter|map|sort|slice|concat|flat|flatMap|values|keys|entries|from|assign)$/], ' +
  'CallExpression[callee.name=/^(photosFor|dueItems|dueUploads|visibleQuestions|buildScreens|pruneAnswers|Object|Array)$/])';
const noFreshSelector = {
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: `CallExpression[callee.name=${STORE_HOOKS}] > ArrowFunctionExpression[body.type!='BlockStatement'] > ${FRESH_BODY}`,
        message:
          'Zustand selector builds a fresh array/object on every render → infinite loop. Select a raw slice and useMemo the derivation (see usePhotosFor), or wrap the selector in useShallow.',
      },
      {
        selector: `CallExpression[callee.name=${STORE_HOOKS}] > ArrowFunctionExpression[body.type!='BlockStatement'] > ConditionalExpression > ${FRESH_BODY}`,
        message:
          'Zustand selector builds a fresh array/object in a branch → infinite loop. Select a raw slice and useMemo the derivation.',
      },
    ],
  },
};

module.exports = defineConfig([
  expoConfig,
  prettier,
  noFreshSelector,
  {
    ignores: [
      'dist/*',
      '.expo/*',
      'node_modules/*',
      'android/*',
      'ios/*',
      'supabase/**',
      'scripts/**', // Deno-owned (and one plain CJS guard): deno lint/check cover these
      'coverage/*',
    ],
  },
]);
