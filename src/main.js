import { PlaywrightCrawler, Dataset, log } from 'crawlee';
import { Actor } from 'apify';
import OpenAI from 'openai';

// ---------------- CONFIGURATION ----------------
const OPENAI_MODEL = "gpt-4o";

// RESTORED STANDARD TIMEOUTS
const TIMEOUT_MS = 120000; // 2 minutes (standard robust timeout)

// Base URLs - REMOVED BF6
const BASE_URLS = {
    "warzone": "https://tracker.gg/warzone",
    "marvel-rivals": "https://tracker.gg/marvel-rivals",
    "fortnite": "https://fortnitetracker.com"
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Platform display names used in the website's search dropdown
const PLATFORM_MAP = {
    'psn': 'PlayStation Network', 'playstation': 'PlayStation Network', 'ps5': 'PlayStation Network',
    'xbox': 'Xbox Live', 'xbl': 'Xbox Live',
    'battlenet': 'battlenet', 'pc': 'battlenet',
    'origin': 'EA', 
    'steam': 'Steam'
};

// ---------------- AI HELPERS ----------------

async function extractStatsWithAI(game, rawText) {
    const systemPrompt = `
    You are a data extractor. Extract player stats for "${game}" from the text dump of a stats profile page.
    
    Rules:
    1. Look for keywords like "K/D", "Win %", "Kills", "Matches".
    2. Return a STRICT JSON object: { "username": string, "rank": string, "kills": string, "matchesPlayed": string, "winRate": string }.
    3. If a specific stat is not found, set it to null.
    `;

    try {
        const completion = await openai.chat.completions.create({
            model: OPENAI_MODEL,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: rawText.slice(0, 50000) }
            ],
            response_format: { type: "json_object" }
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (e) {
        log.error(`AI Extraction Error: ${e.message}`);
        return null;
    }
}

// ---------------- VALIDATION ----------------

function validateInput(input) {
    const errors = [];

    if (!input.players || !Array.isArray(input.players)) {
        errors.push('players must be an array');
    } else if (input.players.length === 0) {
        errors.push('players array cannot be empty');
    } else {
        input.players.forEach((player, index) => {
            if (!player.username || typeof player.username !== 'string') {
                errors.push(`players[${index}].username is required and must be a string`);
            }
            if (!player.games || !Array.isArray(player.games)) {
                errors.push(`players[${index}].games is required and must be an array`);
            }
            if (player.games && player.games.includes('marvel-rivals') && !player.marvelId) {
                errors.push(`players[${index}].marvelId is required for Marvel Rivals`);
            }
        });
    }

    return errors;
}

// ---------------- MAIN ACTOR ----------------

await Actor.init();

if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is required for AI-powered data extraction');
}

const input = await Actor.getInput() || {};
const validationErrors = validateInput(input);

if (validationErrors.length > 0) {
    throw new Error(`Input validation failed: ${validationErrors.join(', ')}`);
}

const { players = [], maxConcurrency = 1 } = input;

const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
    countryCode: 'US',
    ...input.proxyConfiguration
});

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    useSessionPool: true,
    maxConcurrency: Math.max(1, Math.min(maxConcurrency, 5)), 
    
    // Restored standard handler timeout (180 seconds)
    requestHandlerTimeoutSecs: 180, 
    headless: true,

    preNavigationHooks: [async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.route('**/*.{png,jpg,jpeg,mp4,gif}', (route) => route.abort());
    }],

    requestHandler: async ({ page, request }) => {
        const { game, username, platform, marvelId } = request.userData;
        const targetUser = (game === 'marvel-rivals' && marvelId) ? marvelId : username;

        // ---------------- STRATEGY 1: Direct URL Construction ----------------
        let targetUrl = request.url;
        let isDirectNavigation = false;

        if (platform && username) {
            const pSlugMap = {
                'psn': 'psn', 'playstation': 'psn', 'ps5': 'psn',
                'xbox': 'xbl', 'xbl': 'xbl',
                'battlenet': 'battlenet', 'pc': 'battlenet',
                'origin': 'origin',
                'steam': 'steam'
            };
            const pSlug = pSlugMap[platform.toLowerCase()] || platform;

            if (game === 'warzone') {
                targetUrl = `${BASE_URLS[game]}/profile/${pSlug}/${encodeURIComponent(username)}/overview`;
                isDirectNavigation = true;
            } else if (game === 'fortnite') {
                targetUrl = `${BASE_URLS[game]}/profile/all/${encodeURIComponent(username)}`;
                isDirectNavigation = true;
            }
        }

        log.info(`[${game}] Navigating: ${targetUrl} (Direct Mode: ${isDirectNavigation})`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });

        // 1. Consent Handling
        try {
            const consentBtn = page.locator('button:has-text("Accept"), button:has-text("Agree"), button[mode="primary"]');
            if (await consentBtn.count() > 0) {
                await consentBtn.first().click({ timeout: 5000 }).catch(() => { });
                await page.waitForTimeout(1000);
            }
        } catch (e) { }

        // ---------------- STRATEGY 2: Search Interaction ----------------
        const currentUrlInitial = page.url();
        const isHomePage = currentUrlInitial.length < (BASE_URLS[game].length + 5); 

        if (!isDirectNavigation || isHomePage) {
            log.info(`[${game}] Performing Search interaction for: ${targetUser}`);
            
            // --- PLATFORM SELECTION LOGIC ---
            const platformDisplayName = PLATFORM_MAP[platform?.toLowerCase()];

            if (platformDisplayName) {
                log.info(`[${game}] Attempting to select platform: ${platformDisplayName}`);
                try {
                    const dropdownTrigger = page.locator('.platforms-dropdown .dropdown__selected');
                    await dropdownTrigger.waitFor({ state: 'visible', timeout: 5000 });
                    await dropdownTrigger.click();
                    await page.waitForTimeout(500);

                    const platformItem = page.locator(`.dropdown__items .dropdown__item:has-text("${platformDisplayName}")`);
                    await platformItem.click({ timeout: 10000, force: true });
                    
                    await page.waitForTimeout(1000); 
                    log.info(`[${game}] Successfully selected platform: ${platformDisplayName}`);
                } catch (e) {
                    log.warning(`[${game}] Failed to select platform. Falling back to default search: ${e.message}`);
                }
            }
            // --- END PLATFORM SELECTION ---

            // A. Find Input
            const selectors = ['input[type="search"]', '.search-container input', 'input[placeholder*="Search"]', 'form input[type="search"]'];
            let searchInput;
            for (const sel of selectors) {
                if (await page.locator(sel).first().isVisible({ timeout: 5000 })) {
                    searchInput = page.locator(sel).first();
                    break;
                }
            }
            if (!searchInput) throw new Error("Search input not found");

            // B. Type Slow
            await searchInput.click();
            await searchInput.fill('');
            await searchInput.pressSequentially(targetUser, { delay: 150 }); 
            
            // Wait for autocomplete (Restored to 3s)
            await page.waitForTimeout(3000); 

            // C. Autocomplete OR Vue/SPA Enter Submission
            const dropdownOption = page.locator('div[class*="option"], .search-result, .force-search');

            if (await dropdownOption.count() > 0) {
                log.info(`[${game}] Clicking autocomplete suggestion...`);
                await dropdownOption.first().click();
            } else {
                log.info(`[${game}] No autocomplete. Forcing focus and pressing Enter...`);
                
                // 1. Focus input
                await searchInput.focus();
                
                // 2. Press Enter
                await searchInput.press('Enter');
                
                // 3. RESTORED STANDARD WAIT (3 seconds)
                // Enough for standard redirects without hanging the crawler
                await page.waitForTimeout(3000); 
            }
        }

        // 3. Wait for Results
        log.info(`[${game}] Waiting for profile load...`);
        try {
            await page.waitForLoadState('networkidle', { timeout: 20000 }); 
            
            if (game === 'fortnite') {
                await page.waitForSelector('.main-stats__card-header, .user-info, .trn-stats-row', { timeout: 15000 }); 
            }
            // Generic wait
            await page.waitForSelector('.user-info, .profile-header, .stat', { timeout: 15000 });
            
        } catch (e) {
            log.warning(`[${game}] Wait timeout (might be 404 or slow). Checking URL...`);
        }

        const finalUrl = page.url();
        log.info(`[${game}] Final URL: ${finalUrl}`);

        if (finalUrl === BASE_URLS[game] || finalUrl.includes('search?')) {
            log.error(`[${game}] Failed to reach profile page.`);
            await Dataset.pushData({ status: "failed", game, user: targetUser, url: finalUrl, error: "Stuck on Search/Home" });
            return;
        }

        // 4. Extraction
        log.info(`[${game}] Extracting stats...`);
        let contentText;
        try {
            contentText = await page.locator('main').innerText({ timeout: 2000 });
        } catch (e) {
            contentText = await page.locator('body').innerText();
        }

        const stats = await extractStatsWithAI(game, contentText);

        await Dataset.pushData({
            status: "success",
            game,
            user: targetUser,
            url: finalUrl,
            stat_rank: stats?.rank || "N/A",      // Matches "stat_rank" in actor.json
            stat_kills: stats?.kills || "0",      // Matches "stat_kills" in actor.json
            stat_winRate: stats?.winRate || "0%", // Matches "stat_winRate" in actor.json
            stat_matches: stats?.matchesPlayed || "0"
        });
    },
});

const requests = [];
for (const p of players) {
    for (const gameKey of p.games) {
        if (BASE_URLS[gameKey]) {
            requests.push({
                url: BASE_URLS[gameKey],
                userData: {
                    game: gameKey,
                    username: p.username,
                    platform: p.platform,
                    marvelId: p.marvelId
                }
            });
        }
    }
}

await crawler.run(requests);
await Actor.exit();