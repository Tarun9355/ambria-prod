// Minimal flat config. `npm run lint` existed in package.json but had no config file, so it always
// failed — which is how two ReferenceErrors reached production: a `tier` and a `taxFixVid` that were
// referenced but never declared. `vite build` cannot catch those; it bundles without evaluating the
// render path, so the error only appears when a user opens the screen.
//
// Deliberately narrow: no-undef and a couple of certain-bug rules, nothing stylistic. The point is a
// gate that stays green, not a backlog. Widen it later if the team wants to.
export default [
  {
    files: ["src/**/*.{js,jsx}", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        // browser
        window: "readonly", document: "readonly", navigator: "readonly", location: "readonly",
        localStorage: "readonly", sessionStorage: "readonly", fetch: "readonly",
        console: "readonly", alert: "readonly", confirm: "readonly", prompt: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
        requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly",
        FileReader: "readonly", FormData: "readonly", Blob: "readonly", File: "readonly",
        Image: "readonly", URL: "readonly", URLSearchParams: "readonly", AbortController: "readonly",
        matchMedia: "readonly", getComputedStyle: "readonly", ResizeObserver: "readonly",
        IntersectionObserver: "readonly", MutationObserver: "readonly", structuredClone: "readonly",
        crypto: "readonly", btoa: "readonly", atob: "readonly", performance: "readonly",
        HTMLElement: "readonly", Element: "readonly", Node: "readonly", Event: "readonly",
        CustomEvent: "readonly", DOMParser: "readonly", XMLHttpRequest: "readonly",
        MediaRecorder: "readonly", MediaStream: "readonly", AudioContext: "readonly",
        SpeechRecognition: "readonly", webkitSpeechRecognition: "readonly",
        // node (scripts/, vite config)
        process: "readonly", Buffer: "readonly", __dirname: "readonly", globalThis: "readonly",
      },
    },
    // The code carries `// eslint-disable-next-line react-hooks/exhaustive-deps` comments. That
    // plugin is not installed, and an unknown rule in a disable directive is itself an error, so a
    // no-op stub keeps those comments harmless without pulling in a dependency.
    plugins: { "react-hooks": { rules: { "exhaustive-deps": { create: () => ({}) } } } },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      // the one that matters: an identifier used but never declared, imported or destructured
      "no-undef": "error",
      // Warn, not error: most hits are helpers whose ARROW BODY reads a token declared further down.
      // Those run at render, long after every const is initialised, so they are legal — but the same
      // pattern at module/render top level is a real TDZ crash, so it is worth seeing.
      "no-use-before-define": ["warn", { functions: false, classes: false, variables: true }],
      // duplicate object keys silently drop the earlier value
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "no-cond-assign": "error",
      "no-self-assign": "error",
    },
  },
];
