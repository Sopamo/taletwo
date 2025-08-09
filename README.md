# StoryArc

This template should help get you started developing with Vue 3 in Vite.

## Project Overview

StoryArc is a text-based, choose-your-own-adventure game. Players first configure the "vibe" of their story (world setting, inspirations, favorite characters, genres, tone), which is saved in a Pinia store and persisted to localStorage via useStorage. The app then uses the OpenAI API (GPT-5 or the latest available model) to generate the opening passage and three choices for what to do next, plus a concise summary of what happened in that passage. The player selects a choice, we send context back to the model, and the cycle repeats to continue the story.

### Core Flow

1. Configure story
   - Ask: "What do you want the world to look like?" (setting/worldbuilding)
   - Ask: "Which other books do you like?" (inspirations/style)
   - Ask: "Which characters do you like?" (archetypes/traits/names)
   - Ask: "What genre should it be?" (fantasy, sci-fi, mystery, etc.)
   - Ask: "What tone should it have?" (funny, action-packed, romantic, etc.)
   - Persist everything in a Pinia store; state keys use useStorage so it’s mirrored to localStorage automatically.

2. Generate passage
   - Call OpenAI (GPT-5) with the configuration and any existing summary/context.
   - Receive:
     - Passage: the next part of the story.
     - Options: three distinct choices for the player:
       1. Progress: moves the story forward in a straightforward way.
       2. Unexpected: a surprising twist or unusual action.
       3. Something else: an alternative path/idea.
     - Summary: a concise recap of what just happened in this passage. -> persist in pinia/local storage as well

3. Iterate
   - Player chooses one option.
   - We send the chosen option, prior summary, and configuration back to the model to generate the next passage, new options, and an updated summary.

### State and Persistence

- Pinia store holds all configuration and current story context (latest passage, options, summary).
- useStorage ensures the store state is synced with localStorage for persistence across sessions.

### OpenAI Response Contract (proposed)

The model should return a JSON-like structure:

{
"passage": string,
"options": [
{ "type": "progress", "text": string },
{ "type": "unexpected", "text": string },
{ "type": "other", "text": string }
],
"summary": string
}

This keeps the UI logic simple and consistent.

### Tech Stack

- Vue 3 + Vite + TypeScript
- Pinia for state management
- @vueuse/core useStorage for local persistence
- OpenAI API (GPT-5 or latest available)

### Environment

- Create a .env (or .env.local) with:
  - VITE_OPENAI_API_KEY=your_key_here
  - VITE_OPENAI_BASE_URL=https://api.openai.com/v1 (optional)
  - VITE_OPENAI_MODEL=gpt-4o-mini (optional)

---

## Project Description and Architecture Overview

StoryArc is a complex application that utilizes multiple technologies to provide a seamless user experience. The application is built using Vue 3, Vite, and TypeScript, with Pinia for state management and @vueuse/core useStorage for local persistence. The OpenAI API is used to generate passages and options for the user.

The application's architecture is designed to be modular and scalable. The core flow of the application is divided into three main steps: configuration, passage generation, and iteration. The configuration step involves asking the user for input on the story's setting, inspirations, characters, genre, and tone. This information is then persisted to localStorage using Pinia and useStorage.

The passage generation step involves calling the OpenAI API with the user's configuration and any existing summary/context. The API returns a JSON-like structure containing the passage, options, and summary. The application then uses this data to display the passage and options to the user.

The iteration step involves the user selecting an option, which is then sent back to the model to generate the next passage, new options, and an updated summary. This process repeats until the user decides to stop.
