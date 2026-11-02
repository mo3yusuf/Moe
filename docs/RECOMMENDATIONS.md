# CRAVE recommendation engine

Code: `packages/core/src/recommendation/` (pure functions, unit tested) and `apps/api/src/services/{feed,events}.ts`.

## Signals and default weights

| Signal | Default weight | Notes |
| --- | --- | --- |
| Completed order | +8 | Strongest. Also learns time-of-week, spend and pickup/delivery habits |
| Repeat order of the same item | +10 | Detected automatically |
| CRAVE IT (right swipe) | +5 | Also saves the meal to Cravings |
| Add to basket | +3.5 | |
| Save meal | +3 | |
| Follow restaurant / creator | +3 / +2 | |
| Menu item click (Order Now) | +2.5 | |
| Like / share | +2 | |
| Completed view (≥95% or looped) | +1.25 | Weak |
| Long view (≥60%) | +0.75 | Weak |
| Partial view | +0.1 | Basically neutral |
| Quick skip (<1.5 s) | −0.4 | Weak; never treated as a dislike |
| NOT FOR ME (left swipe) | −4 | Hides that exact video permanently |

Each signal propagates to the meal's features (item, restaurant, creator, cuisine, category, dish/ingredient tags, price band) with per-dimension multipliers. **Negative signals barely touch broad dimensions** (cuisine ×0.12), and cuisines/categories have a floor (−4). So one left swipe on prawns never excludes seafood. Consistent rejection lowers it gradually, and exploration still occasionally shows it.

Affinities decay with a 45-day half-life. Swiping back to a previous video doesn't create a second signal (`FeedSessionTracker`).

## Ranking

`score = Σ affinity(dimension) × confidence + price fit + proximity + freshness + trending + orderable + time-of-week habit + explicit cuisine + explicit dietary preference + following − seen penalty`

- **Hard filters (rules, not preferences):** hidden videos, explicit dietary requirements (for example `halal_certified`, only for verified restaurants), ingredients/allergens the user asked to hide, maximum spice, and service radius (25 km).
- **Cold start:** `confidence = min(1, signals / 8)` scales learned affinity. With little history, trending, proximity and onboarding cuisines dominate.
- **Diversity:** a penalty on a restaurant that appeared in the last 3 slots.
- **Exploration:** 15% of slots go to meals from cuisines the user hasn't shown interest in (seeded RNG, reproducible).
- **Explanations:** every item carries privacy-safe reasons ("Because you crave Japanese", "Trending in your area", "Something new to try").

## Configuration & evaluation

- Weights are a zod-validated JSON document in `recommendation_configs` (one active row, versioned). If no row is active, the reviewed defaults in `DEFAULT_RECOMMENDATION_CONFIG` are used.
- Every served item is logged in `recommendation_impressions` with score, reasons, exploration flag and config version, so you can compare CTR, craves and orders per version.
- **These defaults are starting points and have not been tuned on real user data.** Tune them during the Brisbane pilot.

## What is never inferred

Dietary restrictions, allergies, medical conditions and religion are never inferred from behaviour. Ordering halal burgers raises the affinity for those *meals*, but only the user can turn on a "halal certified only" requirement.

## Upgrade path

`rankFeed` is the seam. A learned model (for example two-tower embeddings, or a gradient-boosted ranker trained on `recommendation_impressions` → outcomes) can produce scores in the API, while the hard filters, exploration and diversity re-ranking stay as-is.
