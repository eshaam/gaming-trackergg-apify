# 🎮 AI-Powered Multi-Game Stats Scraper

A powerful, robust Apify Actor that extracts player statistics from various gaming tracker websites (Tracker.gg, FortniteTracker, etc.) using **Playwright** for navigation and **OpenAI GPT-4o** for intelligent data parsing.

![Apify](https://img.shields.io/badge/Apify-Actor-orange) ![Playwright](https://img.shields.io/badge/Playwright-Crawler-green) ![OpenAI](https://img.shields.io/badge/AI-Powered-blue)

## ✨ Features

* **Multi-Game Support:** Currently supports Warzone, Fortnite, and Marvel Rivals.
* **Intelligent Parsing:** Uses OpenAI (GPT-4o) to extract structured JSON data from raw text dumps, making it resilient to minor UI changes on target sites.
* **Smart Navigation:**
    * **Direct Mode:** Constructs direct profile URLs when platforms are known.
    * **Search Mode:** Handles complex single-page application (SPA) search forms (including Vue.js event handling) for finding users manually.
* **Anti-Blocking:** Optimized to handle consent popups, resource blocking (fonts/media), and platform selection dropdowns.
* **Residential Proxy Ready:** Configured to work seamlessly with Apify's residential proxy groups.

## 🚀 How It Works

1.  **Input:** Accepts a list of players, their platforms, and the games to scrape.
2.  **Navigation:** The crawler attempts to visit the profile directly. If that fails (or is impossible), it uses an automated search strategy (typing, platform selection, Enter/Click simulation).
3.  **Extraction:** Once on the profile page, the HTML content is captured.
4.  **AI Processing:** The raw content is sent to OpenAI with a strict system prompt to extract specific stats (K/D, Win Rate, Matches, etc.).
5.  **Output:** Returns a clean JSON dataset.

## 📦 Installation & Usage

### Prerequisites

* [Node.js](https://nodejs.org/) (v16+)
* An [Apify](https://apify.com/) Account (for Proxy and Actor runtime)
* An [OpenAI API Key](https://platform.openai.com/)

### Local Development

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/your-username/game-stats-scraper.git](https://github.com/your-username/game-stats-scraper.git)
    cd game-stats-scraper
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set Environment Variables:**
    Create a `.env` file in the root directory:
    ```env
    OPENAI_API_KEY=sk-your-openai-key-here
    ```

4.  **Configure Input:**
    Modify the `INPUT.json` file in `storage/key_value_stores/default/` (or create a custom input file):
    ```json
    {
      "maxConcurrency": 2,
      "players": [
        {
          "username": "Ninja",
          "platform": "pc",
          "games": ["fortnite"]
        },
        {
          "username": "Symfuhny",
          "platform": "psn",
          "games": ["warzone"]
        }
      ],
      "proxyConfiguration": {
        "useApifyProxy": true
      }
    }
    ```

5.  **Run the Actor:**
    ```bash
    npm start
    ```

## 📄 Input Schema

The actor expects a JSON input object with the following structure:

| Field | Type | Description |
| :--- | :--- | :--- |
| `players` | Array | **Required.** List of player objects to scrape. |
| `maxConcurrency` | Number | Maximum number of concurrent pages to open (1-5). |
| `proxyConfiguration` | Object | Apify Proxy configuration (Residential recommended). |

**Player Object:**

```json
{
  "status": "success",
  "game": "warzone",
  "user": "Symfuhny",
  "url": "[https://tracker.gg/warzone/profile/psn/Symfuhny/overview](https://tracker.gg/warzone/profile/psn/Symfuhny/overview)",
  "stats": {
    "username": "Symfuhny",
    "rank": "Diamond 1",
    "kills": "54,320",
    "matchesPlayed": "8,400",
    "winRate": "12.5%"
  }
}

Game Key,Target URL
warzone,tracker.gg/warzone
fortnite,fortnitetracker.com
marvel-rivals,tracker.gg/marvel-rivals





  "username": "User123",     // Required
  "platform": "psn",         // Optional (psn, xbox, battlenet, steam, origin)
  "games": ["warzone"],      // Required. Array of game keys.
  "marvelId": "User#1234"    // Required only for Marvel Rivals
}