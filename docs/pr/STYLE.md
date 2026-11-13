# Pitch style guide

*For everything in `docs/pr/`: the slides, [narrative.md](narrative.md), [devpost.md](devpost.md), the video script ([slides/notes.md](slides/notes.md)) and the older pitch files. Name and tagline: Karthik, 2026-11-13. Colors follow the app's [docs/STYLE_GUIDE.md](../STYLE_GUIDE.md) (`brandBlue` #0866FF); this file only adds what the pitch needs on top.*

## Name

| Use | Write | Examples |
|---|---|---|
| The feature | **Muse Curios**, a new feature in Facebook | "Muse Curios, a new feature in Facebook, brings people closer through tiny games." Never imply a separate app: the app is Facebook. |
| One game we make | **a Curio** (capital C) | "Make a Curio", "Fog Chase, a Curio by Dev", "Today's Curio in your Group" |
| Where only one word fits (a tab, a button, a chip) | **Curios** | the Curios tab |
| The dictionary word (slide 1 only) | curio (lower case) | "cu·rio, noun" |
| The definition slide's sense 2 (Karthik's words, verbatim) | sense 2, credited *(Muse Curios)* | "an interactive short-form experience with infinite possibility, meant to breed collaboration through friendly competitiveness" |

- Capitalize **Curio** whenever it means our game. "game" stays fine as the ordinary word for the category: "a Curio is a tiny game".
- **Don't write** "Whims", "Whim", "Bubbles", "Bubble", "Muse Games" or a singular "Muse Curio" as the product. They survive only in code names (`Bubble*`, `docs/BUBBLES.md`, `FB_TAB=bubbles`) and in quotes about the naming history. Never "pop in", "blow a bubble" or "on a whim" puns.
- Meta's models are **Muse Spark**, **Muse Ember**, **Muse Wonder** and **Muse Image**. "Muse" alone means the models, never our feature.

## Tagline

Karthik's words, verbatim, with the question mark:

> When the world is your muse, how will you create the content of tomorrow?

It goes on the last slide only (never slide 1), in the Devpost tagline field and at the end of the video. Don't shorten or paraphrase it.

## Words

- **Use:** Curio, make (a Curio), play, share to a Group, challenge, best of 5, weekly board, remix, your friends, your Group, the people you play with. Never "your people".
- **Avoid:** "Game" capitalized as a product noun, "user" (say "people"), "engagement" without saying what kind, "viral", "addictive", "AI-generated content" (say "made with Muse").
- **Status words:** "in the app", "on the server, app next", "simulated". Never "live" for group play: it's async (same seed, each person in their own time).

## Color and type

| Token | Value | Where |
|---|---|---|
| Blue | `#0866FF` | The gradient start; the same `brandBlue` as the app |
| Violet | `#8A3FFC` | The gradient end |
| Gradient | `linear-gradient(120deg, #0866FF, #8A3FFC)` | Title slide "Curios", key words, charts, the top bar |
| Ink | `#1C1E21` | Body text, "Muse" on the title slide |
| Secondary | `#65676B` | Captions and labels |
| Surface | `#F0F2F5` | Cards |
| Grey bars | `#BCC0C4` | The baseline in charts (the line to beat) |
| Meaning | blue = competing, violet = collaborating | Tag features with their color (boards, best of 5 and challenges blue; making together, remix and Group play violet). Used once on the philosophy slide, then quietly |

- **No pink.** The app's `reelsPink` stays in the app; it never appears in the pitch.
- **Font:** Figtree (SIL Open Font License, `slides/fonts/`), our open stand-in for Meta's typeface. Weights: 800 for titles and big numbers, 700 for labels and kickers, 500–600 for body and captions. Install it on the presenting Mac before importing `deck.pptx`. The app itself uses SF Pro.
- **Slide 1 (the definition):** the wordmark "Muse" in ink, "Curios" in the gradient, on white.
- **Slide look (Karthik, 2026-11-13):** one idea per slide, about 15 words or fewer on screen, big type, layouts that vary (one number, a statement, a screenshot, a dark slide). The gradient on a title word on 2–3 slides at most. No decorative blobs or arrows; cards only for real lists. One big number per stat slide, with its source line.

## Numbers and labels

- Numbers as digits with units: "40 s", "~1 MB", "86%", "11.2B", "624 commits". Use "about" or "~" when it's an estimate.
- Anything from a simulation says **"simulated"** on the same slide or line (the ranker's 70.3%, Group Blend's 8.7% → 32%).
- Company-reported figures say so: "(company-reported)".
- Don't round a cited number differently in different places. Change it in [narrative.md](narrative.md) first, then everywhere else.

## Citations

- In docs: a bracketed number that points into [sources.md](sources.md), e.g. "86% … [79]". Add new sources there with the date checked.
- On slides: a short source line at the foot of the slide, e.g. "LinkedIn Newsroom, 2026 (company-reported) [79]".
- Sources from Bayan's literature review, which lost its links in the paste, are cited by author and year, e.g. "(Appodeal, 2025)".
- Quotes from real people: verbatim, with the source and date, and text only (no clipped audio or video).
