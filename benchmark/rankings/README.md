# Blind rankings

Store one timestamped record per same-theme pair. Records name only the theme and anonymous slots, plus presentation order, play counts, choice or tie, and permitted notes. Validate them against `benchmark/schemas/ranking.schema.json`.

Lock and checksum or commit the complete ranking set before opening the slot key. Never rewrite these records with configuration names after unblinding; join configuration identity in derived analysis instead.
