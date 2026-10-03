# Robust interval fit for printed nutrient values

## Policy and scope

`robust_interval` is an explicit comparison mode for estimator experiments. Existing requests remain `legacy_point`: they retain the previous squared, normalized point loss. Robust mode uses the 2026-10-01 CAA tolerance rules for a verified fixed label value, or the exact declared interval for a verified range label. A value explicitly marked as estimated is rejected because the CAA guide describes it as a reasonable estimate with its own basis and recordkeeping requirements, rather than a fixed value to which the fixed-value tolerance can be applied.

The first fit set remains energy, protein, fat, carbohydrate, and salt equivalent. Any nutrient requested as an output is removed from fit evidence and from the random seed input, so the value being evaluated cannot tune its own estimate. A missing typed reference falls back to the existing point value in robust mode, with Huber loss and no CAA interval. If a typed reference is present but unverified, lacks a source, has an estimated value kind, or has a mismatched explicit basis, the request is rejected rather than falling back to a point value.

## CAA interval rules

The Consumer Affairs Agency's sixth edition guideline, issued October 2026, gives fixed-value tolerances of ±20% for energy, protein, fat, saturated fat, carbohydrate, dietary fiber, sodium, and several other nutrients; −20% / +50% for calcium, iron, and vitamins A, D, E, and K; and −20% / +80% for vitamins B1, B2, B6, B12, and C. The same guide lists low-content exceptions for protein, fat, carbohydrate, sugar, and fiber below 2.5 g/100 g (or 100 ml for applicable beverages) with ±0.5 g; saturated fat below 0.5 g with ±0.1 g; sodium below 25 mg with ±5 mg; and energy below 25 kcal with ±5 kcal. These low-content exceptions apply only where the relevant zero-display amount is defined. See the [CAA guideline, sixth edition, pages 32–34](https://www.caa.go.jp/policies/policy/food_labeling/nutrient_declearation/business/assets/food_labeling_cms206_261001_01.pdf) and [Food Labeling Standards, Annex 9](https://www.caa.go.jp/policies/policy/food_labeling/food_labeling_act/assets/food_labeling_cms201_261001_02.pdf).

For a fixed printed amount `L`, the service uses these intervals:

```text
relative rule: [0.8L, 1.2L] for ordinary nutrients
               [0.8L, 1.5L] for calcium, iron, A, and E
               [0.8L, 1.8L] for B1, B2, and C

low-content rule: ([L-a, L+a] ∩ [0, T)) ∪ ([0.8L, 1.2L] ∩ [T, ∞))
```

This union is a mathematical derivation from the threshold condition on the analysis result; it is not a formula printed by CAA or a statistical confidence interval.

`T`, absolute allowance `a`, and the zero-display upper limit `Z` are scaled by `basis.amount / 100` when an explicit basis is present. The supported low-content rules are protein, fat, carbohydrate, and fiber (`T=2.5 g`, `a=0.5 g`, `Z=0.5 g`); saturated fat (`T=0.5 g`, `a=0.1 g`, `Z=0.1 g`); energy (`T=25 kcal`, `a=5 kcal`, `Z=5 kcal`); and salt equivalent (`T=0.0635 g`, `a=0.0127 g`, `Z=0.0127 g`). The sodium values are converted to this app's salt-equivalent unit using `sodium mg × 2.54 / 1000`.

For an explicit zero label, the interval is `[0, Z)`, with an open upper endpoint. Thus a zero label is not treated as a measured zero when the CAA zero-display allowance applies. If a basis is absent, the service applies only the relative tolerance and marks `basisMode: relative_only` plus `basisStatus: unknown`; it does not infer a mass from a volume or a volume from a mass. The `ml` low-content basis is limited by the CAA rule to applicable beverages such as soft drinks; callers must verify that product category before supplying an `ml` basis.

The low-content formula is the set of analytical results `q` accepted by the applicable Annex 9 rule: `q<T` uses the absolute allowance, while `q≥T` uses the relative allowance. It is a regulatory acceptance interval, not a statistical confidence interval. The service represents it as one interval because the branches meet at the threshold for these rules: each absolute allowance is 20% of its threshold, and each uses the ±20% relative rule. For example, protein `L=2` on a 100 g basis yields `[1.5, 2.5)`, `L=2.4` yields `[1.9, 2.88]`, `L=2.5` yields `[2, 3]`, and `L=3` yields `[2.5, 3.6]`. A declared range is returned unchanged and does not receive another tolerance expansion. `decimalPlaces` is validated as a nonnegative integer but does not widen the interval; measurement-method rounding inversion is outside this version.

## Shared robust loss

Both candidate beam scoring and final ingredient-ratio optimization use the same interval separation, normalization, and Huber loss. If the predicted interval overlaps the accepted reference interval, its distance is zero. Otherwise, distance is the gap between the nearest endpoints. The normalization scale is `max(floor, 0.02 × reference amount)`, with a floor of `0.5 kcal` for energy and `0.05` in the nutrient's native unit for other fit nutrients. Fixed values normalize against the printed amount; declared ranges use their upper endpoint so a wide declared interval does not make its scale artificially smaller.

```text
z = intervalDistance / normalizationScale
Huber(z) = z²                    when |z| ≤ 1
           2|z| − 1              otherwise
```

The beam supplies the candidate nutrient minimum/maximum as its predicted interval. The final ratio optimizer supplies a point prediction. The legacy path remains squared point error. Candidate priors, the existing 0.08 prior weight, search budgets, and deterministic seed source stay unchanged. Explicit label references alter the loss only; they do not overwrite reported nutrient values. A verified zero reference with a positive CAA interval upper bound is not reused as an exact-zero composition cap.

The `EstimationTrace` records the selected fit mode and typed intervals actually used, including the interval rule version, whether it used the low-content or relative-only rule, and whether the basis was explicit or unknown. Source citation strings are used to validate incoming references and are not copied into the trace.

## Sources checked

- Consumer Affairs Agency, *Guideline for Nutrient Labeling Based on the Food Labeling Act*, sixth edition, October 2026, pp. 32–34: [official PDF](https://www.caa.go.jp/policies/policy/food_labeling/nutrient_declearation/business/assets/food_labeling_cms206_261001_01.pdf). Retrieved 2026-10-04 JST; SHA-256 `19c3ea8b95db9922352e6812e6c9275e357f1707730ccbc822db5c9a875f4408`.
- Consumer Affairs Agency, *Food Labeling Standards, Annex 9*: [official PDF](https://www.caa.go.jp/policies/policy/food_labeling/food_labeling_act/assets/food_labeling_cms201_261001_02.pdf). Retrieved 2026-10-04 JST; SHA-256 `7155dd1f2adddd9d42a9ed31d400204295c7b11f7d0134ab9b378b7d0a7fa8c6`.
