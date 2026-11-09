# assets/landing

Flow's landing page as one experience document for the shared landing kit (`@stackra/experience`, figentra/stackra
#403). `index.json` is the home page: a list of `{ id, block, props, children? }` nodes, every human string a
`{ "en", "ar" }` pair. Code, commands and file names are plain strings and are never translated.

**PROPOSED, Arabic awaiting Qossai Alqawasmi's review.** The English follows Flow's voice and messaging in
`figentra/brand` (`brands/flow/story/`). The Arabic is a transcreated draft that follows the Arabic voice guide and its
glossary. Nothing Arabic ships before his review.

## The page, top to bottom

| Node | Block | What it holds |
| --- | --- | --- |
| `header` | `experience.site_header` | Docs, Getting started, Presets; GitHub |
| `hero` | `experience.hero_machine` | "Nothing ships off-spec.", the descriptor in the lede, Get started, the install command |
| `statement` | `experience.statement` | Why a spec drifts, and what Flow keeps in the loop |
| `path` | `experience.chapter_title` | "Follow one change.": issue `gh-12` from request to merge |
| `specify` … `land` | `experience.station` + `experience.step_switcher` | Specify, Clarify, Approve, Plan, Build, Gate, Land, each with real file formats and commands |
| `gives`, `features` | `experience.chapter_title`, `experience.bento_grid` | Six capabilities |
| `presets-title`, `presets` | `experience.chapter_title`, `experience.product_cards` | `neutral`, `stackra` and your own preset package |
| `try-it-title`, `try-it` | `experience.chapter_title`, `experience.terminal_stage` | A session recorded from the real CLI (`lines` empty until recorded) |
| `states` | `experience.mono_display` | "DRAFT → DONE." |
| `closing`, `closing-cta` | `experience.statement`, `experience.cta_row` | The closing line, three facts, Get started |
| `footer` | `experience.site_footer` | Docs and open-source links; Figentra Technologies L.L.C |
| `dock` | `experience.page_dock` | The seven stations' titles and status lines |

## Owed before it ships

- **Art.** `hero.art` points at `/art/flow`, four single-tone mask layers (`flow.ground.svg`, `flow.dots.svg`,
  `flow.line.svg`, `flow.core.svg`) that don't exist yet. The strata posters are Stackra's; Flow's own posters come
  from its brand kit.
- **The terminal session.** `try-it.lines` is empty. Record it from the real CLI with the kit's recorder on the
  Testbed; never write output lines by hand.
- **Links.** They point at the docs pages on GitHub until Flow's docs site has its own URL.
- **The `brand` of the product cards.** `flow` and `stackra` are brand ids from `figentra/brand`; check them against
  the kit once it renders.

## Rules for the copy

- Nothing measured is stated: no install count, repository count, time saved or customer name.
- Flow checks agreement and gates what may land. It never claims the code is correct, and it never says Flow needs
  Stackra.
- The states are named by their exact words: Draft, Clarified, Planned, Tasked, Implementing, Done.
