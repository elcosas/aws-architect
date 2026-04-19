# AWS-Architect Frontend

Frontend for ArcForge / AWS-Architect.

This application is a React + Vite chat interface where a user types a project
idea, views assistant responses, and sees Mermaid diagrams and CloudFormation 
code rendered directly in the UI.

## Folder structure

```text
frontend/
├── index.html
├── package.json
├── vite.config.js
├── eslint.config.js
├── public/
└── src/
		├── main.jsx
		├── App.jsx
		├── MermaidChart.jsx
		├── assets/
		├── components/
		├── pages/
		└── styles/
				├── App.css
				├── index.css
				└── specific-components/
```

## What this frontend does

- Provides a chat-style interface for AWS architecture generation.
- Lets the user type a project idea into the input box.
- Shows assistant replies in Markdown using `react-markdown`.
- Renders Mermaid code blocks using a dedicated `MermaidChart` component.
- Renders generated CloudFormation YAML in syntax-highlighted code blocks.
- Includes suggestion chips to quickly seed common AWS prompts.
- Supports auto-scrolling, typing indicators, and a scroll-to-bottom control.

## Current behavior

The frontend communicates with the AWS backend exclusively over WebSockets to ensure real-time streaming of architecture generation and validation.

The current app flow is:

1. App establishes a WebSocket connection to AWS API Gateway on load.
2. User types a prompt into the chat input.
3. The message is sent through the WebSocket to the Lambda backend.
4. The app shows a temporary loading/typing state.
5. The backend responds with Mermaid diagram text and reasoning.
6. The frontend renders the Mermaid code block as an SVG diagram.
7. The user can approve the diagram, which triggers another WebSocket request to generate CloudFormation code.
## Main components

- `src/App.jsx`
	- Main chat experience, session state management, and WebSocket communication.
	- Handles prompt entry, live AWS responses, scrolling, and Markdown
		rendering.
- `src/MermaidChart.jsx`
	- Uses the Mermaid library to convert diagram text into SVG.
	- Initializes Mermaid once and re-renders when the chart text changes.
- `src/styles/App.css`
	- Chat layout, message bubbles, typing indicator, chips, scroll button, and
		Mermaid diagram styling.
- `src/styles/index.css`
	- Base document styling and root layout.
- `src/main.jsx`
	- Application entry point that mounts the React tree.

## Tech stack

- React 19
- Vite
- Mermaid
- react-markdown
- ESLint

## Scripts

From the `frontend/` folder:

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

## Setup

```bash
cd frontend
npm install
npm run dev
```

If dependencies become inconsistent after pulling changes from another branch,
run a clean reinstall:

```bash
rm -rf node_modules
npm ci
```

## Dependencies

- `react` / `react-dom` — UI framework
- `react-markdown` — Renders assistant responses written in Markdown
- `mermaid` — Renders architecture diagrams from Mermaid text

## Notes

- The frontend requires `VITE_WS_URL` to be set in your environment to connect to the AWS backend. If it fails to connect, you can fall back to test mode by setting `VITE_TEST_MODE=true`.
- The Mermaid renderer expects fenced code blocks labeled as `mermaid`.
- Keep the UI fast and stable by avoiding unnecessary re-renders in the chat and
	diagram components.
