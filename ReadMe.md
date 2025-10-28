# A simple youtube videos summarizer

This application is an express based api that uses genkit for building AI Powered application. This exposes an endpoint to summarize youtube video

## Technologies

1. node v20+
2. genkit 1.22
3. expressjs 4.2.x

### How to run this application?

1. Rename .env.sample file to .env
2. Get the GEMINI_API_KEY from https://aistudio.google.com
3. Get the YOUTUBE_API_KEY from https://console.cloud.google.com/ by enabling Youtube API 
4. Run npm install
````
npm i
````
5. Run npm run genkit:ui 
````
npm run genkit:ui
````

![demo](./images/demo.gif)
