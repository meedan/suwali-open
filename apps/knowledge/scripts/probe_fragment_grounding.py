#!/usr/bin/env python3
"""Probe the chat endpoint with content-bearing fragments and flag ungrounded replies.

A bare fragment like "1649" classifies as non_question and takes the conversational
branch, which runs no retrieval and no judge. The reply must therefore assert nothing
about the world. This checks that across many draws, since the failure is stochastic.

Run it from the host against the published port, or inside the knowledge container
with --url http://localhost:8000/chat/. Stdlib only, so it needs no venv.

Usage:
    ./probe_fragment_grounding.py                      # 100 high-association years
    ./probe_fragment_grounding.py --repeat 20          # each probe 20 times
    ./probe_fragment_grounding.py 1649 --repeat 50     # hammer one known-bad case
    ./probe_fragment_grounding.py --file probes.txt    # one probe per line
    ./probe_fragment_grounding.py --verbose            # print every reply

Exits 1 if any reply looks like it asserts a fact.
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import Any, NamedTuple

# years with strong parametric associations, ie. the ones most likely to pull a fact
# out of the model. 1649 is the case that originally regressed.
DEFAULT_PROBES: list[str] = [
    "1066", "1215", "1258", "1291", "1347", "1381", "1415", "1453", "1455", "1492",
    "1503", "1517", "1534", "1543", "1588", "1600", "1607", "1618", "1620", "1637",
    "1642", "1649", "1666", "1687", "1688", "1707", "1715", "1755", "1759", "1769",
    "1776", "1783", "1789", "1799", "1804", "1812", "1815", "1837", "1848", "1859",
    "1861", "1865", "1867", "1871", "1876", "1885", "1889", "1896", "1901", "1903",
    "1912", "1914", "1917", "1918", "1922", "1929", "1933", "1936", "1939", "1941",
    "1945", "1947", "1948", "1949", "1953", "1955", "1957", "1961", "1963", "1964",
    "1968", "1969", "1971", "1972", "1975", "1979", "1980", "1984", "1986", "1989",
    "1990", "1991", "1994", "1997", "1998", "2000", "2001", "2003", "2004", "2008",
    "2010", "2011", "2012", "2014", "2016", "2019", "2020", "2021", "2022", "2024",
]  # fmt: skip

# heuristic only. the grouped-template output is the real signal, since it lets you
# read every distinct reply the model produced.
FACT_WORDS = re.compile(
    r"\b(was|were|marked|century|war|revolution|born|died|king|queen|president|"
    r"battle|treaty|signed|founded|independence|empire|invention|discovered|"
    r"began|ended|famous|notable|significant|history|historical)\b",
    re.I,
)

YEAR_TOKEN = re.compile(r"\b[12]\d{3}\b")


class Result(NamedTuple):
    probe: str
    answer: str
    intent: str | None
    flagged: bool


def run_probe(url: str, hub_id: int, message_id: int, text: str) -> Result:
    body = json.dumps({"hub_id": hub_id, "message_id": message_id, "message": text}).encode()
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})

    try:
        # url is the operator's own --url argument, defaulting to localhost; a dev probe, not a service path
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        payload: dict[str, Any] = json.loads(urllib.request.urlopen(request, timeout=120).read())
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        return Result(text, f"<ERROR {exc}>", None, True)

    answer = str(payload.get("answer") or "").strip()
    metadata: dict[str, Any] = payload.get("metadata") or {}
    intent = metadata.get("router_intent")

    return Result(text, answer, None if intent is None else str(intent), bool(FACT_WORDS.search(answer)))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("probes", nargs="*", help="probe strings (default: 100 high-association years)")
    parser.add_argument("--file", help="read probes from a file, one per line")
    parser.add_argument("--repeat", type=int, default=1, help="draws per probe (default: 1)")
    parser.add_argument("--hub-id", type=int, default=2, help="hub to query (default: 2)")
    parser.add_argument("--concurrency", type=int, default=8, help="parallel requests (default: 8)")
    parser.add_argument("--url", default="http://localhost:8000/chat/", help="chat endpoint")
    parser.add_argument("--verbose", action="store_true", help="print every reply")
    return parser.parse_args()


def collect_probes(args: argparse.Namespace) -> list[str]:
    if args.file:
        with open(args.file) as handle:
            probes = [line.strip() for line in handle if line.strip()]
    else:
        probes = list(args.probes) or DEFAULT_PROBES
    return [p for p in probes for _ in range(args.repeat)]


def main() -> int:
    args = parse_args()
    probes = collect_probes(args)
    if not probes:
        print("no probes to run")
        return 1

    # unique-ish base so repeated runs do not collide on message_id
    base_id = int(time.time()) % 1_000_000 * 1000

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        results = list(
            pool.map(
                lambda item: run_probe(args.url, args.hub_id, base_id + item[0], item[1]),
                enumerate(probes),
            )
        )
    elapsed = time.perf_counter() - started

    intents = Counter(result.intent for result in results)
    flagged = [result for result in results if result.flagged]

    print(f"probed: {len(results)} ({len(set(probes))} distinct) in {elapsed:.1f}s")
    print(f"intents: {dict(intents)}")

    if args.verbose:
        print("\nall replies:")
        for result in results:
            mark = "!" if result.flagged else " "
            print(f"  {mark} {result.probe:<8} [{result.intent}] {result.answer[:120]}")

    print(f"\nFLAGGED (reply contains fact-shaped language): {len(flagged)}")
    for result in flagged:
        print(f"  {result.probe} [{result.intent}] {result.answer[:200]}")

    print("\ndistinct reply templates by frequency:")
    templates = Counter(YEAR_TOKEN.sub("<YEAR>", result.answer) for result in results)
    for answer, count in templates.most_common(15):
        print(f"  {count:4d}x  {answer[:130]}")
    print(f"  ({len(templates)} distinct templates)")

    if flagged:
        print("\nFAIL: at least one reply asserted something.")
        return 1

    # zero events in n trials bounds the rate at roughly 3/n with 95% confidence
    print(f"\nPASS: no ungrounded replies. 95% upper bound on rate ~{3 / len(results):.1%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
