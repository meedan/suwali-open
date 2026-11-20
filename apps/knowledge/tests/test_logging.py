import logging
from unittest.mock import MagicMock, call, patch
from uuid import uuid4

from langchain_core.messages import HumanMessage

from app.core.debug_log import TRUNCATE
from app.core.logging import (
    LLMLoggingHandler,
    OpenAIRetryCauseFilter,
    publish_chat_duration_details_metrics,
    publish_metric,
)


@patch("app.core.logging.Config")
@patch("app.core.logging.boto3")
def test_publish_metric_skipped_in_local_env(mock_boto3: MagicMock, mock_config_class: MagicMock) -> None:
    mock_config_class.return_value.deploy_env = "local"

    publish_metric("test.metric", 1.0)

    mock_boto3.client.assert_not_called()


@patch("app.core.logging.Config")
@patch("app.core.logging.boto3")
def test_publish_metric_sends_environment_dimension(mock_boto3: MagicMock, mock_config_class: MagicMock) -> None:
    mock_config_class.return_value.deploy_env = "prod"
    mock_config_class.return_value.aws_region = "eu-west-1"
    mock_cloudwatch = MagicMock()
    mock_boto3.client.return_value = mock_cloudwatch

    publish_metric("test.metric", 42.0)

    mock_cloudwatch.put_metric_data.assert_called_once()
    call_kwargs = mock_cloudwatch.put_metric_data.call_args[1]
    metric_data = call_kwargs["MetricData"][0]
    assert metric_data["MetricName"] == "test.metric"
    assert metric_data["Value"] == 42.0
    assert {"Name": "Environment", "Value": "prod"} in metric_data["Dimensions"]
    assert not any(d["Name"] == "HubId" for d in metric_data["Dimensions"])


@patch("app.core.logging.Config")
@patch("app.core.logging.boto3")
def test_publish_metric_includes_hub_id_dimension_when_provided(
    mock_boto3: MagicMock, mock_config_class: MagicMock
) -> None:
    mock_config_class.return_value.deploy_env = "staging"
    mock_config_class.return_value.aws_region = "eu-west-1"
    mock_cloudwatch = MagicMock()
    mock_boto3.client.return_value = mock_cloudwatch

    publish_metric("test.metric", 1.0, hub_id=7)

    call_kwargs = mock_cloudwatch.put_metric_data.call_args[1]
    dimensions = call_kwargs["MetricData"][0]["Dimensions"]
    assert {"Name": "Environment", "Value": "staging"} in dimensions
    assert {"Name": "HubId", "Value": "7"} in dimensions


@patch("app.core.logging.Config")
@patch("app.core.logging.boto3")
def test_publish_metric_hub_id_coerced_to_string(mock_boto3: MagicMock, mock_config_class: MagicMock) -> None:
    mock_config_class.return_value.deploy_env = "prod"
    mock_config_class.return_value.aws_region = "eu-west-1"
    mock_cloudwatch = MagicMock()
    mock_boto3.client.return_value = mock_cloudwatch

    publish_metric("test.metric", 1.0, hub_id="42")

    call_kwargs = mock_cloudwatch.put_metric_data.call_args[1]
    dimensions = call_kwargs["MetricData"][0]["Dimensions"]
    assert {"Name": "HubId", "Value": "42"} in dimensions


@patch("app.core.logging.Config")
@patch("app.core.logging.boto3")
def test_publish_metric_omits_hub_id_dimension_when_none(mock_boto3: MagicMock, mock_config_class: MagicMock) -> None:
    mock_config_class.return_value.deploy_env = "prod"
    mock_config_class.return_value.aws_region = "eu-west-1"
    mock_cloudwatch = MagicMock()
    mock_boto3.client.return_value = mock_cloudwatch

    publish_metric("test.metric", 1.0, hub_id=None)

    call_kwargs = mock_cloudwatch.put_metric_data.call_args[1]
    dimensions = call_kwargs["MetricData"][0]["Dimensions"]
    assert not any(d["Name"] == "HubId" for d in dimensions)
    assert len(dimensions) == 1


@patch("app.core.logging.Config")
@patch("app.core.logging.boto3")
def test_publish_metric_includes_question_type_dimension_when_provided(
    mock_boto3: MagicMock, mock_config_class: MagicMock
) -> None:
    mock_config_class.return_value.deploy_env = "prod"
    mock_config_class.return_value.aws_region = "eu-west-1"
    mock_cloudwatch = MagicMock()
    mock_boto3.client.return_value = mock_cloudwatch

    publish_metric("test.metric", 1.0, question_type="synthesis:temporal")

    call_kwargs = mock_cloudwatch.put_metric_data.call_args[1]
    dimensions = call_kwargs["MetricData"][0]["Dimensions"]
    assert dimensions == [
        {"Name": "Environment", "Value": "prod"},
        {"Name": "QuestionType", "Value": "synthesis:temporal"},
    ]


@patch("app.core.logging.Config")
@patch("app.core.logging.boto3")
def test_publish_metric_uses_custom_namespace(mock_boto3: MagicMock, mock_config_class: MagicMock) -> None:
    mock_config_class.return_value.deploy_env = "prod"
    mock_config_class.return_value.aws_region = "eu-west-1"
    mock_cloudwatch = MagicMock()
    mock_boto3.client.return_value = mock_cloudwatch

    publish_metric("my.metric", 5.0, namespace="Custom/NS")

    call_kwargs = mock_cloudwatch.put_metric_data.call_args[1]
    assert call_kwargs["Namespace"] == "Custom/NS"


@patch("app.core.logging.Config")
@patch("app.core.logging.boto3")
def test_publish_metric_works_for_demo_env(mock_boto3: MagicMock, mock_config_class: MagicMock) -> None:
    mock_config_class.return_value.deploy_env = "demo"
    mock_config_class.return_value.aws_region = "eu-west-1"
    mock_cloudwatch = MagicMock()
    mock_boto3.client.return_value = mock_cloudwatch

    publish_metric("test.metric", 1.0)

    mock_cloudwatch.put_metric_data.assert_called_once()


@patch("app.core.logging.Config")
@patch("app.core.logging.boto3")
def test_publish_metric_swallows_cloudwatch_errors(mock_boto3: MagicMock, mock_config_class: MagicMock) -> None:
    mock_config_class.return_value.deploy_env = "prod"
    mock_config_class.return_value.aws_region = "eu-west-1"
    mock_cloudwatch = MagicMock()
    mock_boto3.client.return_value = mock_cloudwatch
    mock_cloudwatch.put_metric_data.side_effect = Exception("CloudWatch unavailable")

    publish_metric("test.metric", 1.0)  # must not raise


class TestLLMLoggingHandler:
    @patch("app.core.logging.Config")
    def test_enabled_reflects_config_flag(self, mock_config_class: MagicMock) -> None:
        mock_config_class.return_value.enable_llm_logging = False
        assert LLMLoggingHandler().enabled is False

        mock_config_class.return_value.enable_llm_logging = True
        assert LLMLoggingHandler().enabled is True

    @patch("app.core.logging.log_llm_call")
    @patch("app.core.logging.Config")
    def test_disabled_skips_logging_on_llm_end(
        self, mock_config_class: MagicMock, mock_log_llm_call: MagicMock
    ) -> None:
        mock_config_class.return_value.enable_llm_logging = False
        handler = LLMLoggingHandler()
        run_id = uuid4()

        handler.on_chat_model_start({}, [[HumanMessage(content="hi")]], run_id=run_id)
        handler.on_llm_end(MagicMock(generations=[[MagicMock(text="answer")]]), run_id=run_id)

        mock_log_llm_call.assert_not_called()
        assert run_id not in handler._pending  # on_chat_model_start returned early too

    @patch("app.core.logging.log_llm_call")
    @patch("app.core.logging.Config")
    def test_enabled_logs_full_exchange_on_llm_end(
        self, mock_config_class: MagicMock, mock_log_llm_call: MagicMock
    ) -> None:
        mock_config_class.return_value.enable_llm_logging = True
        handler = LLMLoggingHandler()
        run_id = uuid4()
        serialized = {"kwargs": {"model_name": "gpt-4o-mini"}}
        response = MagicMock(generations=[[MagicMock(text="hello there")]])

        handler.on_chat_model_start(serialized, [[HumanMessage(content="hi")]], run_id=run_id)
        handler.on_llm_end(response, run_id=run_id)

        mock_log_llm_call.assert_called_once()
        model_name, prompt, text = mock_log_llm_call.call_args[0]
        assert model_name == "gpt-4o-mini"
        assert "hi" in prompt
        assert text == "hello there"

    @patch("app.core.logging.logger")
    @patch("app.core.logging.Config")
    def test_disabled_skips_logging_on_llm_error(self, mock_config_class: MagicMock, mock_logger: MagicMock) -> None:
        mock_config_class.return_value.enable_llm_logging = False
        handler = LLMLoggingHandler()

        handler.on_llm_error(Exception("boom"), run_id=uuid4())

        mock_logger.warning.assert_not_called()
        mock_logger.bind.return_value.warning.assert_not_called()

    @patch("app.core.logging.logger")
    @patch("app.core.logging.Config")
    def test_enabled_logs_warning_on_llm_error(self, mock_config_class: MagicMock, mock_logger: MagicMock) -> None:
        mock_config_class.return_value.enable_llm_logging = True
        handler = LLMLoggingHandler()

        handler.on_llm_error(Exception("boom"), run_id=uuid4())

        mock_logger.bind.assert_called_once_with(**{TRUNCATE: True})
        mock_logger.bind.return_value.warning.assert_called_once()


def _llm_neo4j_calls(mock_publish_metric: MagicMock) -> tuple[float, float]:
    calls_by_name = {c.args[0]: c.args[1] for c in mock_publish_metric.call_args_list}
    return calls_by_name["answer.duration.llm"], calls_by_name["answer.duration.neo4j"]


@patch("app.core.logging.publish_metric")
def test_publish_chat_duration_details_metrics_skips_when_empty(mock_publish_metric: MagicMock) -> None:
    publish_chat_duration_details_metrics({}, hub_id=1)

    mock_publish_metric.assert_not_called()


@patch("app.core.logging.publish_metric")
def test_publish_chat_duration_details_metrics_skips_when_none(mock_publish_metric: MagicMock) -> None:
    publish_chat_duration_details_metrics(None, hub_id=1)

    mock_publish_metric.assert_not_called()


@patch("app.core.logging.publish_metric")
def test_publish_chat_duration_details_metrics_publishes_aggregates_only(mock_publish_metric: MagicMock) -> None:
    duration_details = {"rewriting": 10.0, "internal_kb": 20.0}

    publish_chat_duration_details_metrics(duration_details, hub_id=5)

    mock_publish_metric.assert_any_call("answer.duration.llm", 10.0, unit="Milliseconds", hub_id=5)
    mock_publish_metric.assert_any_call("answer.duration.neo4j", 20.0, unit="Milliseconds", hub_id=5)


@patch("app.core.logging.publish_metric")
def test_publish_chat_duration_details_metrics_passes_hub_id_to_aggregates(mock_publish_metric: MagicMock) -> None:
    publish_chat_duration_details_metrics({"rewriting": 10.0}, hub_id="7")

    mock_publish_metric.assert_any_call("answer.duration.llm", 10.0, unit="Milliseconds", hub_id="7")
    mock_publish_metric.assert_any_call("answer.duration.neo4j", 0.0, unit="Milliseconds", hub_id="7")


@patch("app.core.logging.publish_metric")
def test_publish_chat_duration_details_metrics_publishes_question_type_variants(
    mock_publish_metric: MagicMock,
) -> None:
    publish_chat_duration_details_metrics(
        {"rewriting": 10.0, "internal_kb": 20.0}, hub_id=5, question_type="question:recency"
    )

    assert mock_publish_metric.call_args_list == [
        call("answer.duration.llm", 10.0, unit="Milliseconds", hub_id=5),
        call("answer.duration.llm", 10.0, unit="Milliseconds", question_type="question:recency"),
        call("answer.duration.neo4j", 20.0, unit="Milliseconds", hub_id=5),
        call("answer.duration.neo4j", 20.0, unit="Milliseconds", question_type="question:recency"),
    ]


@patch("app.core.logging.publish_metric")
def test_publish_chat_duration_details_metrics_skips_question_type_variants_when_none(
    mock_publish_metric: MagicMock,
) -> None:
    publish_chat_duration_details_metrics({"rewriting": 10.0}, hub_id=5)

    assert mock_publish_metric.call_count == 2
    assert all("question_type" not in c.kwargs for c in mock_publish_metric.call_args_list)


@patch("app.core.logging.publish_metric")
def test_publish_chat_duration_details_metrics_standalone_llm_keys(mock_publish_metric: MagicMock) -> None:
    duration_details = {
        "rewriting": 10.0,
        "unified_classification_decomposition": 20.0,
        "language_detection": 5.0,
    }

    publish_chat_duration_details_metrics(duration_details, hub_id=None)

    llm_total, neo4j_total = _llm_neo4j_calls(mock_publish_metric)
    assert llm_total == 35.0
    assert neo4j_total == 0.0


@patch("app.core.logging.publish_metric")
def test_publish_chat_duration_details_metrics_internal_kb_wrapper_excludes_nested_keys(
    mock_publish_metric: MagicMock,
) -> None:
    # initial_search/search_total/relevance_filtering/rephrasing/hyde/answer_judging all land
    # in the same dict as internal_kb because Retriever.run()'s own duration_details gets
    # merged straight into it - only the wrapper should be counted, not its nested children.
    duration_details = {
        "internal_kb": 500.0,
        "initial_search": 200.0,
        "search_total": 200.0,
        "relevance_filtering": 10.0,
        "rephrasing": 150.0,
        "hyde": 100.0,
        "answer_judging": 30.0,
    }

    publish_chat_duration_details_metrics(duration_details, hub_id=1)

    llm_total, neo4j_total = _llm_neo4j_calls(mock_publish_metric)
    assert neo4j_total == 500.0
    assert llm_total == 0.0


@patch("app.core.logging.publish_metric")
def test_publish_chat_duration_details_metrics_falls_back_without_internal_kb_wrapper(
    mock_publish_metric: MagicMock,
) -> None:
    # defensive fallback: nested keys present without their internal_kb wrapper
    duration_details = {
        "initial_search": 200.0,
        "search_total": 100.0,
        "relevance_filtering": 10.0,
        "rephrasing": 150.0,
        "hyde": 100.0,
        "answer_judging": 30.0,
    }

    publish_chat_duration_details_metrics(duration_details, hub_id=1)

    llm_total, neo4j_total = _llm_neo4j_calls(mock_publish_metric)
    assert neo4j_total == 310.0
    assert llm_total == 280.0


@patch("app.core.logging.publish_metric")
def test_publish_chat_duration_details_metrics_decomposition_total_excludes_sub_query_keys(
    mock_publish_metric: MagicMock,
) -> None:
    # decomposition_total's wall-clock fully contains each sub_query_N - only the wrapper
    # should count toward llm_total; sub_query_N_internal_kb is the one signal kept separately.
    duration_details = {
        "decomposition_total": 900.0,
        "sub_query_0": 400.0,
        "sub_query_0_internal_kb": 300.0,
        "sub_query_1": 350.0,
        "sub_query_1_internal_kb": 250.0,
        "synthesis": 50.0,
    }

    publish_chat_duration_details_metrics(duration_details, hub_id=1)

    llm_total, neo4j_total = _llm_neo4j_calls(mock_publish_metric)
    assert llm_total == 950.0  # decomposition_total + synthesis, NOT + sub_query_0/1
    assert neo4j_total == 550.0  # sub_query_0_internal_kb + sub_query_1_internal_kb


@patch("app.core.logging.publish_metric")
def test_publish_chat_duration_details_metrics_regression_llm_never_exceeds_total(
    mock_publish_metric: MagicMock,
) -> None:
    # Regression test: previously summing decomposition_total + sub_query_N together
    # inflated answer.duration.llm past total_duration_ms for decomposition-heavy requests.
    total_duration_ms = 1000.0
    duration_details = {
        "decomposition_total": 900.0,
        "sub_query_0": 850.0,
        "sub_query_0_internal_kb": 700.0,
        "sub_query_1": 800.0,
        "sub_query_1_internal_kb": 650.0,
        "sub_query_2": 780.0,
        "sub_query_2_internal_kb": 600.0,
        "synthesis": 50.0,
    }

    publish_chat_duration_details_metrics(duration_details, hub_id=1)

    llm_total, _ = _llm_neo4j_calls(mock_publish_metric)
    assert llm_total <= total_duration_ms


@patch("app.core.logging.publish_metric")
def test_publish_chat_duration_details_metrics_falls_back_without_decomposition_total(
    mock_publish_metric: MagicMock,
) -> None:
    # defensive fallback: sub_query_N present without their decomposition_total wrapper
    duration_details = {
        "sub_query_0": 400.0,
        "sub_query_0_internal_kb": 300.0,
        "sub_query_1": 350.0,
        "sub_query_1_internal_kb": 250.0,
    }

    publish_chat_duration_details_metrics(duration_details, hub_id=1)

    llm_total, neo4j_total = _llm_neo4j_calls(mock_publish_metric)
    assert llm_total == 750.0
    assert neo4j_total == 550.0


@patch("app.core.logging.publish_metric")
def test_publish_chat_duration_details_metrics_unclassified_key_excluded_from_both_buckets(
    mock_publish_metric: MagicMock,
) -> None:
    duration_details = {"rewriting": 10.0, "enrichment_aggregation": 999.0}

    publish_chat_duration_details_metrics(duration_details, hub_id=1)

    llm_total, neo4j_total = _llm_neo4j_calls(mock_publish_metric)
    assert llm_total == 10.0
    assert neo4j_total == 0.0


@patch("app.core.logging.publish_metric")
def test_publish_chat_duration_details_metrics_full_request_shape(mock_publish_metric: MagicMock) -> None:
    # A realistic direct-KB (non-decomposed) request's duration_details.
    duration_details = {
        "language_detection": 5.0,
        "rewriting": 40.0,
        "unified_classification_decomposition": 60.0,
        "internal_kb": 800.0,
        "initial_search": 300.0,
        "search_total": 300.0,
        "rephrasing": 150.0,
        "hyde": 100.0,
        "answer_judging": 30.0,
    }

    publish_chat_duration_details_metrics(duration_details, hub_id=1)

    llm_total, neo4j_total = _llm_neo4j_calls(mock_publish_metric)
    assert llm_total == 105.0  # language_detection + rewriting + unified_classification_decomposition
    assert neo4j_total == 800.0  # internal_kb only
    assert mock_publish_metric.call_count == 2


def _openai_record(level: int, msg: str) -> logging.LogRecord:
    return logging.LogRecord("openai._base_client", level, __file__, 1, msg, None, None)


def test_openai_retry_cause_filter_keeps_the_retry_and_its_cause_only() -> None:
    f = OpenAIRetryCauseFilter()
    assert f.filter(_openai_record(logging.INFO, "Retrying request to %s in %f seconds"))
    assert f.filter(_openai_record(logging.DEBUG, "Encountered httpx.TimeoutException"))
    assert f.filter(_openai_record(logging.DEBUG, "Encountered Exception"))
    # request bodies are logged at debug too: they carry prompts and must stay out
    assert not f.filter(_openai_record(logging.DEBUG, "Request options: %s"))
