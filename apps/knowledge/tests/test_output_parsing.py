import pytest
from langchain_core.messages import AIMessage

from app.core.output_parsing import (
    TruncatedCompletionError,
    _reject_truncated_completion,
    _repair_garbled_json,
    _strip_reasoning_tags,
    is_truncated_completion,
    loads_merging_duplicate_keys,
    strip_reasoning,
)


class TestRejectTruncatedCompletion:
    def test_raises_on_openai_length_finish_reason(self) -> None:
        msg = AIMessage(content='{"answer": "cut off mid', response_metadata={"finish_reason": "length"})
        with pytest.raises(TruncatedCompletionError, match="truncated"):
            _reject_truncated_completion(msg)

    def test_raises_on_bedrock_max_tokens_stop_reason(self) -> None:
        msg = AIMessage(content='{"answer": "cut off mid', response_metadata={"stop_reason": "max_tokens"})
        with pytest.raises(TruncatedCompletionError, match="truncated"):
            _reject_truncated_completion(msg)

    def test_raises_on_bedrock_converse_stop_reason(self) -> None:
        msg = AIMessage(content='{"answer": "cut off mid', response_metadata={"stopReason": "max_tokens"})
        with pytest.raises(TruncatedCompletionError, match="truncated"):
            _reject_truncated_completion(msg)

    def test_passthrough_on_normal_stop(self) -> None:
        msg = AIMessage(content='{"answer": "complete"}', response_metadata={"finish_reason": "stop"})
        assert _reject_truncated_completion(msg) is msg

    def test_passthrough_without_metadata(self) -> None:
        msg = AIMessage(content='{"answer": "complete"}')
        assert _reject_truncated_completion(msg) is msg

    def test_is_truncated_completion_matches_finish_reasons(self) -> None:
        truncated = AIMessage(content="x", response_metadata={"finish_reason": "length"})
        complete = AIMessage(content="x", response_metadata={"finish_reason": "stop"})
        assert is_truncated_completion(truncated) is True
        assert is_truncated_completion(complete) is False


class TestStripReasoningTags:
    def test_strips_reasoning_tags_before_json(self) -> None:
        content = (
            "<reasoning>Some thinking here.\nMultiple lines.</reasoning>"
            '{"message": "hello", "reasoning": "resolved pronouns"}'
        )
        result = _strip_reasoning_tags(AIMessage(content=content))
        assert result.content == '{"message": "hello", "reasoning": "resolved pronouns"}'

    def test_strips_thinking_tags(self) -> None:
        content = '<thinking>internal thought</thinking>{"answer": "42"}'
        result = _strip_reasoning_tags(AIMessage(content=content))
        assert result.content == '{"answer": "42"}'

    def test_strips_scratchpad_tags(self) -> None:
        content = '<scratchpad>notes</scratchpad>{"answer": "42"}'
        result = _strip_reasoning_tags(AIMessage(content=content))
        assert result.content == '{"answer": "42"}'

    def test_passthrough_when_no_tags(self) -> None:
        content = '{"message": "hello", "reasoning": "none needed"}'
        result = _strip_reasoning_tags(AIMessage(content=content))
        assert result.content == content

    def test_passthrough_non_string_content(self) -> None:
        msg = AIMessage(content=[{"type": "text", "text": "hello"}])
        result = _strip_reasoning_tags(msg)
        assert result.content == [{"type": "text", "text": "hello"}]

    def test_preserves_response_metadata(self) -> None:
        metadata = {"token_usage": {"completion_tokens": 100}}
        content = '<reasoning>thought</reasoning>{"ok": true}'
        result = _strip_reasoning_tags(AIMessage(content=content, response_metadata=metadata))
        assert result.response_metadata == metadata

    def test_strips_whitespace_around_json(self) -> None:
        content = '<reasoning>thought</reasoning>\n\n  {"ok": true}  \n'
        result = _strip_reasoning_tags(AIMessage(content=content))
        assert result.content == '{"ok": true}'

    def test_multiline_reasoning_block(self) -> None:
        content = (
            "<reasoning>\n"
            "Step 1: resolve pronouns\n"
            "Step 2: add context\n"
            "Step 3: produce JSON\n"
            "</reasoning>\n"
            '{"message": "What did Meedan announce?"}'
        )
        result = _strip_reasoning_tags(AIMessage(content=content))
        assert result.content == '{"message": "What did Meedan announce?"}'

    def test_runnable_lambda_works(self) -> None:
        content = '<reasoning>think</reasoning>{"ok": true}'
        result = strip_reasoning.invoke(AIMessage(content=content))
        assert result.content == '{"ok": true}'

    def test_empty_content_after_stripping(self) -> None:
        content = "<reasoning>only reasoning, no json</reasoning>"
        result = _strip_reasoning_tags(AIMessage(content=content))
        assert result.content == ""

    def test_mismatched_tags_not_stripped(self) -> None:
        content = '<reasoning>open tag{"ok": true}'
        result = _strip_reasoning_tags(AIMessage(content=content))
        assert result.content == content


class TestLoadsMergingDuplicateKeys:
    def test_plain_json_unchanged(self) -> None:
        assert loads_merging_duplicate_keys('{"a": 1, "b": [2, 3]}') == {"a": 1, "b": [2, 3]}

    def test_duplicate_scalar_key_keeps_first(self) -> None:
        assert loads_merging_duplicate_keys('{"a": 1, "a": 2}') == {"a": 1}

    def test_duplicate_object_key_merges_first_wins(self) -> None:
        """Regression: prod completion re-emitted "classification" holding only message_language,
        and last-wins json.loads clobbered the complete first object (SUWALI prod, Aug 2026)."""
        text = (
            '{"classification": {"is_question": true, "sources": ["internal_kb"], "confidences": [0.8]}, '
            '"decomposition": {"should_decompose": false}, '
            '"classification": {"message_language": "en", "sources": []}}'
        )
        result = loads_merging_duplicate_keys(text)
        assert result["classification"] == {
            "is_question": True,
            "sources": ["internal_kb"],
            "confidences": [0.8],
            "message_language": "en",
        }
        assert result["decomposition"] == {"should_decompose": False}

    def test_nested_duplicate_keys_also_merged(self) -> None:
        text = '{"outer": {"a": 1, "a": 2, "b": {"x": 1}, "b": {"y": 2}}}'
        assert loads_merging_duplicate_keys(text) == {"outer": {"a": 1, "b": {"x": 1, "y": 2}}}

    def test_truncated_json_falls_back_to_partial_parser(self) -> None:
        assert loads_merging_duplicate_keys('{"a": 1, "b": {"c": 2') == {"a": 1, "b": {"c": 2}}


class TestCurlyQuoteRepair:
    def test_fused_value_close_and_key_open_quote(self) -> None:
        """Regression from prod, Aug 2026: the synthesizer never closed the answer string.
        Its closing quote and the next key's opening quote fused into one curly quote."""
        text = '{"answer":"Effects fade between years three and eight.,”sources_used":["Paper A"],"confidence":0.42}'
        assert loads_merging_duplicate_keys(text) == {
            "answer": "Effects fade between years three and eight.",
            "sources_used": ["Paper A"],
            "confidence": 0.42,
        }

    def test_curly_quoted_key_repaired(self) -> None:
        assert loads_merging_duplicate_keys('{"a": 1, “b”: 2}') == {"a": 1, "b": 2}

    def test_curly_quoted_string_value_repaired(self) -> None:
        assert loads_merging_duplicate_keys('{"a": “hello”}') == {"a": "hello"}

    def test_curly_close_of_string_value_repaired(self) -> None:
        assert loads_merging_duplicate_keys('{"a": "x”, "b": 2}') == {"a": "x", "b": 2}

    def test_prose_curly_quotes_preserved_in_valid_json(self) -> None:
        text = '{"a": "she said “hi” loudly"}'
        assert loads_merging_duplicate_keys(text) == {"a": "she said “hi” loudly"}


class TestTrailingCommaRepair:
    def test_prod_synthesizer_array_trailing_comma(self) -> None:
        """Regression: synthesizer emitted a trailing comma in sources_used (SUWALI prod, Aug 2026)."""
        text = (
            '{"answer": "Meedan has an office in the United States (established as a nonprofit in '
            "San Francisco in 2006) and has a presence in Brazil via its partnership to form the "
            "Confirma election-fact-checking coalition. There is no information available about an "
            'office in Russia.", "sources_used": ["Sub-query 1 - USA: Meedan established nonprofit '
            'in San Francisco in 2006 and operates in the United States", '
            '"Sub-query 2 - Brazil: Meedan partners to form Confirma in Brazil and works with '
            "Brazil's electoral court\", "
            '"Sub-query 3 - Russia: NOT FOUND information on Russia",], "confidence": 0.65}'
        )
        result = loads_merging_duplicate_keys(text)
        assert result["answer"].startswith("Meedan has an office in the United States")
        assert result["sources_used"] == [
            (
                "Sub-query 1 - USA: Meedan established nonprofit in San Francisco in 2006"
                " and operates in the United States"
            ),
            (
                "Sub-query 2 - Brazil: Meedan partners to form Confirma in Brazil"
                " and works with Brazil's electoral court"
            ),
            "Sub-query 3 - Russia: NOT FOUND information on Russia",
        ]
        assert result["confidence"] == 0.65

    def test_object_trailing_comma(self) -> None:
        assert loads_merging_duplicate_keys('{"a": 1,}') == {"a": 1}

    def test_nested_array_trailing_comma(self) -> None:
        assert loads_merging_duplicate_keys('{"a": [1, 2,], "b": 3}') == {"a": [1, 2], "b": 3}

    def test_multiple_trailing_commas(self) -> None:
        assert loads_merging_duplicate_keys('{"a": [1,], "b": 2,}') == {"a": [1], "b": 2}


class TestRepairGarbledJson:
    def test_duplicate_keys_canonicalized(self) -> None:
        message = AIMessage(content='{"a": {"x": 1}, "a": {"y": 2}}')
        result = _repair_garbled_json(message)
        assert result.content == '{"a": {"x": 1, "y": 2}}'

    def test_markdown_fenced_json_canonicalized(self) -> None:
        message = AIMessage(content='```json\n{"a": 1, "a": 2}\n```')
        result = _repair_garbled_json(message)
        assert result.content == '{"a": 1}'

    def test_curly_structural_quotes_canonicalized(self) -> None:
        message = AIMessage(content='{"a": “x”}')
        result = _repair_garbled_json(message)
        assert result.content == '{"a": "x"}'

    def test_trailing_comma_canonicalized(self) -> None:
        message = AIMessage(content='{"a": [1, 2,], "b": 3}')
        result = _repair_garbled_json(message)
        assert ",]" not in result.content
        assert result.content == '{"a": [1, 2], "b": 3}'

    def test_non_json_content_passes_through(self) -> None:
        message = AIMessage(content="not json at all")
        assert _repair_garbled_json(message) is message

    def test_non_string_content_passes_through(self) -> None:
        message = AIMessage(content=[{"type": "text", "text": '{"a": 1}'}])
        assert _repair_garbled_json(message) is message

    def test_preserves_response_metadata(self) -> None:
        metadata = {"token_usage": {"completion_tokens": 100}}
        message = AIMessage(content='{"a": 1, "a": 2}', response_metadata=metadata)
        assert _repair_garbled_json(message).response_metadata == metadata
