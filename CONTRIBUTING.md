# Contributing

Thanks for helping out!

## Getting started

1. Fork and clone the repo.
2. Run `npm start` and open http://localhost:5173 in Chrome or Edge.
3. Edit the files in `public/`. There's no build step, so just reload the page.

## Guidelines

- Keep it dependency-free. The app is plain HTML, CSS, and JavaScript on purpose so anyone can host it anywhere.
- Run `npm run check` before opening a PR. It syntax-checks the JavaScript files.
- Test on a real call or with a second device playing Chinese audio if you touch speech recognition or playback.
- Keep pull requests focused, and describe what you changed and how you tested it.

## Ideas

- More language pairs (the `LANGS` table in `public/app.js` is the place to start)
- Better voice selection for Cantonese
- An official translation API option with a user-supplied key

## Reporting bugs

Open an issue with your browser and version, the language you selected, and what you expected compared with what happened.
