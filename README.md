# MyGPT

A standalone ChatGPT desktop application for macOS.

It was created because the native ChatGPT app uses a gray background, while a black background makes reading and working with chats much more comfortable. That’s why I decided to quickly put together a custom, user-friendly solution tailored to my own preferences.

## Features

- Native macOS desktop application
- Chromium-based rendering
- Opens ChatGPT directly in a standalone window
- Custom application icon
- No browser tabs or address bar
- Minimal and clean interface

## Tech Stack

- Electron
- Chromium
- electron-builder
- JavaScript
- macOS

## Requirements

- macOS
- Node.js
- npm

## Development

Install dependencies:

```bash
npm install
```

Run the application:

```bash
npm start
```

## Build

Create a macOS DMG:

```bash
npm run dist
```

The resulting application will be available in the `dist` directory.

## Author

Denys Oleksiienko
