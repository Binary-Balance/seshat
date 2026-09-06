# Preserve assurance when optimising

Seshat must not silently reduce the scope or confidence of its CRAP analysis or
mutation testing to improve speed. Performance comparisons must cover the same
work and outcomes; any sampling or partial run must be explicit in the request
and report, and execution errors must not be presented as successful assurance.
This constrains performance optimisations because a faster but weaker check does
not satisfy the project's assurance goal.
