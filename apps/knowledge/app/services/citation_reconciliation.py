from __future__ import annotations

from loguru import logger


def reconcile_cited_ids(cited_ids: list[str], known_ids: list[str]) -> list[str]:
    """map citation strings to known document ids (exact, else unambiguous prefix)."""
    if not cited_ids or not known_ids:
        return cited_ids

    known_set = set(known_ids)
    result = list(cited_ids)

    # exact pass-through; prefix against full known set, but ids that appear
    # later as exact matches are reserved (see TestReconcileCitedIds)
    for i, cited in enumerate(cited_ids):
        if cited in known_set:
            result[i] = cited
            continue
        # ids claimed exactly later in the list; exclude from earlier prefix match
        later_exact = {cited_ids[j] for j in range(i + 1, len(cited_ids)) if cited_ids[j] in known_set}
        matches = [kid for kid in known_ids if kid.startswith(cited) and kid not in later_exact]
        if len(matches) == 1:
            resolved = matches[0]
            logger.debug(f"Reconciled cited ID '{cited}' -> '{resolved}'")
            result[i] = resolved
        # else leave cited (ambiguous)

    final_unmatched = [c for c in result if c not in known_set]
    if final_unmatched:
        logger.warning(
            f"Citation reconciliation: {len(final_unmatched)} unresolved IDs {final_unmatched} (known: {known_ids})"
        )

    return result


def at_least_one_citation_resolves(cited_ids: list[str], known_ids: list[str]) -> bool:
    """True when some cited id maps (exact or unambiguous prefix) to a known document id."""
    if not cited_ids or not known_ids:
        return False
    known_set = set(known_ids)
    resolved = reconcile_cited_ids(cited_ids, known_ids)
    return any(r in known_set for r in resolved)
