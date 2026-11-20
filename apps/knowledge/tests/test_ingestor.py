import asyncio
import io
import os
import re
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.constants import DOCUMENT_SUMMARY_LABEL
from app.core.errors import IngestionError
from app.core.ingestion_validation import IngestionValidationError, ValidationCode
from app.services.ingestor import Ingestor
from tests.utils import mock_get_file


def _make_txt(text: str) -> str:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        f.write(text)
        return f.name


def _make_docx(text: str) -> str:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            "</Types>",
        )
        zf.writestr(
            "_rels/.rels",
            '<?xml version="1.0"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            "</Relationships>",
        )
        zf.writestr(
            "word/_rels/document.xml.rels",
            '<?xml version="1.0"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
        )
        zf.writestr(
            "word/document.xml",
            '<?xml version="1.0"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            f"<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body>"
            "</w:document>",
        )
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
        f.write(buf.getvalue())
        return f.name


def _make_pdf(text: str) -> str:
    content = f"BT /F1 12 Tf 50 700 Td ({text}) Tj ET\n".encode()
    stream_len = len(content)

    header = b"%PDF-1.4\n"
    obj1 = b"1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n"
    obj2 = b"2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n"
    obj3 = (
        b"3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n"
        b"/Resources <</Font <</F1 <</Type /Font /Subtype /Type1\n"
        b"/BaseFont /Helvetica /Encoding /WinAnsiEncoding>>>>>>\n"
        b"/Contents 4 0 R>>\nendobj\n"
    )
    obj4 = f"4 0 obj\n<</Length {stream_len}>>\nstream\n".encode() + content + b"endstream\nendobj\n"

    offsets = []
    pos = len(header)
    for obj in [obj1, obj2, obj3, obj4]:
        offsets.append(pos)
        pos += len(obj)

    xref_pos = pos
    xref = b"xref\n0 5\n" + b"0000000000 65535 f \n"
    for off in offsets:
        xref += f"{off:010d} 00000 n \n".encode()
    trailer = f"trailer\n<</Size 5 /Root 1 0 R>>\nstartxref\n{xref_pos}\n%%EOF\n".encode()

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(header + obj1 + obj2 + obj3 + obj4 + xref + trailer)
        return f.name


@patch("app.services.ingestor._MARKITDOWN")
@patch("app.services.ingestor.requests.get")
def test_ingestor_download_file(mock_get: MagicMock, mock_markitdown: MagicMock) -> None:
    mock_get.return_value = mock_get_file()
    mock_markitdown.convert.return_value = MagicMock(markdown="extracted text")

    ingestor = Ingestor(hub_id=1, document_id="RG9jdW1lbnQvMQo=", file_url="https://example.com/data.docx", text="")
    asyncio.run(ingestor._download_file())

    assert ingestor.text == "extracted text"
    assert ingestor.text_is_markdown is True


@patch("app.services.ingestor.extract_layout_text")
@patch("app.services.ingestor._MARKITDOWN")
@patch("app.services.ingestor.requests.get")
def test_ingestor_download_pdf_uses_layout_extractor(
    mock_get: MagicMock, mock_markitdown: MagicMock, mock_extract_layout: MagicMock
) -> None:
    mock_get.return_value = mock_get_file(content=b"%PDF-fake")
    mock_extract_layout.return_value = "layout extracted text"

    ingestor = Ingestor(hub_id=1, document_id="RG9jdW1lbnQvMQo=", file_url="https://example.com/report.pdf", text="")
    asyncio.run(ingestor._download_file())

    mock_extract_layout.assert_called_once()
    mock_markitdown.convert.assert_not_called()
    assert ingestor.text == "layout extracted text"
    assert ingestor.text_is_markdown is False


@patch("app.services.ingestor._MARKITDOWN")
@patch("app.services.ingestor.requests.get")
def test_ingestor_download_pdf_password_protected_raises_validation_error(
    mock_get: MagicMock, mock_markitdown: MagicMock
) -> None:
    fixture = Path(__file__).parent / "data" / "test_document_p123.pdf"
    mock_get.return_value = mock_get_file(content=fixture.read_bytes())

    ingestor = Ingestor(hub_id=1, document_id="RG9jdW1lbnQvMQo=", file_url="https://example.com/locked.pdf", text="")

    with pytest.raises(IngestionValidationError) as exc_info:
        asyncio.run(ingestor._download_file())

    assert exc_info.value.code == ValidationCode.PDF_PASSWORD_PROTECTED
    mock_markitdown.convert.assert_not_called()


@patch("app.services.ingestor.requests.get")
def test_ingestor_raises_on_failed_download(mock_get: MagicMock) -> None:
    mock_get.return_value = mock_get_file(status_code=404)
    ingestor = Ingestor(
        hub_id=1,
        document_id="RG9jdW1lbnQvMQo=",
        file_url="https://example.com/missing.txt",
        text="",
    )

    with pytest.raises(Exception, match="404 Error"):
        asyncio.run(ingestor._download_file())


@patch("app.services.ingestor.requests.get")
def test_download_file_extracts_txt(mock_get: MagicMock) -> None:
    tmp_path = _make_txt("Hello TXT content")
    with open(tmp_path, "rb") as f:
        content = f.read()
    os.unlink(tmp_path)

    mock_get.return_value = mock_get_file(content=content)

    ingestor = Ingestor(hub_id=1, document_id="doc1", file_url="https://example.com/file.txt", text="")
    asyncio.run(ingestor._download_file())

    assert "Hello TXT content" in ingestor.text
    assert ingestor.text_is_markdown is False


@patch("app.services.ingestor.requests.get")
def test_download_file_txt_with_non_ascii_utf8(mock_get: MagicMock) -> None:
    """txt files containing non-ASCII UTF-8 bytes (e.g. accented chars) should not raise UnicodeDecodeError."""
    content = "Ça va bien — résumé".encode("utf-8")
    mock_get.return_value = mock_get_file(content=content, apparent_encoding="utf-8")

    ingestor = Ingestor(hub_id=1, document_id="doc1", file_url="https://example.com/file.txt", text="")
    asyncio.run(ingestor._download_file())

    assert "résumé" in ingestor.text


@patch("app.services.ingestor.requests.get")
def test_download_file_txt_with_hindi(mock_get: MagicMock) -> None:
    """txt files in Hindi (Devanagari, UTF-8) should be decoded correctly."""
    hindi_text = "यह एक परीक्षण है।"
    content = hindi_text.encode("utf-8")
    mock_get.return_value = mock_get_file(content=content, apparent_encoding="utf-8")

    ingestor = Ingestor(hub_id=1, document_id="doc1", file_url="https://example.com/article.txt", text="")
    asyncio.run(ingestor._download_file())

    assert hindi_text in ingestor.text


@patch("app.services.ingestor.requests.get")
def test_download_file_txt_does_not_call_markitdown(mock_get: MagicMock) -> None:
    """txt files should bypass markitdown entirely."""
    mock_get.return_value = mock_get_file(content=b"plain text")

    with patch("app.services.ingestor._MARKITDOWN") as mock_markitdown:
        ingestor = Ingestor(hub_id=1, document_id="doc1", file_url="https://example.com/file.txt", text="")
        asyncio.run(ingestor._download_file())

    mock_markitdown.convert.assert_not_called()


@patch("app.services.ingestor.requests.get")
def test_download_file_extracts_md(mock_get: MagicMock) -> None:
    content = "# Hello MD content".encode("utf-8")
    mock_get.return_value = mock_get_file(content=content)

    ingestor = Ingestor(hub_id=1, document_id="doc1", file_url="https://example.com/file.md", text="")
    asyncio.run(ingestor._download_file())

    assert "# Hello MD content" in ingestor.text
    assert ingestor.text_is_markdown is True


@patch("app.services.ingestor.requests.get")
def test_download_file_extracts_markdown_extension(mock_get: MagicMock) -> None:
    content = "# Hello content".encode("utf-8")
    mock_get.return_value = mock_get_file(content=content)

    ingestor = Ingestor(hub_id=1, document_id="doc1", file_url="https://example.com/file.markdown", text="")
    asyncio.run(ingestor._download_file())

    assert "# Hello content" in ingestor.text
    assert ingestor.text_is_markdown is True


@patch("app.services.ingestor.requests.get")
def test_download_file_md_does_not_call_markitdown(mock_get: MagicMock) -> None:
    """md files should bypass markitdown entirely."""
    mock_get.return_value = mock_get_file(content=b"# heading")

    with patch("app.services.ingestor._MARKITDOWN") as mock_markitdown:
        ingestor = Ingestor(hub_id=1, document_id="doc1", file_url="https://example.com/file.md", text="")
        asyncio.run(ingestor._download_file())

    mock_markitdown.convert.assert_not_called()


@patch("app.services.ingestor.requests.get")
def test_download_file_extracts_docx(mock_get: MagicMock) -> None:
    tmp_path = _make_docx("Hello DOCX content")
    with open(tmp_path, "rb") as f:
        content = f.read()
    os.unlink(tmp_path)

    mock_get.return_value = mock_get_file(content=content)

    ingestor = Ingestor(hub_id=1, document_id="doc1", file_url="https://example.com/report.docx", text="")
    asyncio.run(ingestor._download_file())

    assert "Hello DOCX content" in ingestor.text


@patch("app.services.ingestor._MARKITDOWN")
@patch("app.services.ingestor.requests.get")
def test_download_file_extracts_pdf(mock_get: MagicMock, mock_markitdown: MagicMock) -> None:
    tmp_path = _make_pdf("HelloPDF")
    with open(tmp_path, "rb") as f:
        content = f.read()
    os.unlink(tmp_path)

    mock_get.return_value = mock_get_file(content=content)

    ingestor = Ingestor(hub_id=1, document_id="doc1", file_url="https://example.com/doc.pdf", text="")
    asyncio.run(ingestor._download_file())

    assert "HelloPDF" in ingestor.text
    assert ingestor.text_is_markdown is False
    mock_markitdown.convert.assert_not_called()


@patch("app.services.ingestor._MARKITDOWN")
@patch("app.services.ingestor.requests.get")
def test_download_file_pdf_preserves_two_column_prose(mock_get: MagicMock, mock_markitdown: MagicMock) -> None:
    """Regression: MarkItDown form-grid shredded 'Derek Riggs' into table cells on this PDF."""
    fixture = Path(__file__).parent / "data" / "beast-over-hammersmith-wikipedia.pdf"
    content = fixture.read_bytes()
    mock_get.return_value = mock_get_file(content=content)

    ingestor = Ingestor(hub_id=1, document_id="doc1", file_url="https://example.com/beast.pdf", text="")
    asyncio.run(ingestor._download_file())

    collapsed = re.sub(r"\s+", " ", ingestor.text)
    assert "cover illustration by longtime artist Derek Riggs" in collapsed
    assert "| Derek |" not in ingestor.text
    assert ingestor.text_is_markdown is False
    mock_markitdown.convert.assert_not_called()


@patch("app.services.ingestor.SimpleKGPipeline")
@patch("app.services.text_splitter_factory.TextSplitterFactory.get_text_splitter")
@patch("app.services.embedder_factory.SentenceTransformerEmbeddings")
@patch("app.services.neo4j_llm.OpenAILLMWithTiming")
@patch("app.services.ingestor.Neo4jClient")
def test_init_pipeline(
    mock_neo4j_client: MagicMock,
    mock_llm: MagicMock,
    mock_embedder: MagicMock,
    mock_get_text_splitter: MagicMock,
    mock_pipeline: MagicMock,
) -> None:
    from app.services.ingestor import Ingestor

    mock_driver = MagicMock()
    mock_neo4j_client.return_value.get_driver.return_value = mock_driver

    mock_get_text_splitter.return_value = MagicMock()

    ingestor = Ingestor(1, "doc1", "file.txt", "")
    ingestor._init_pipeline()

    # raw/.txt ingestion never sets the markdown provenance flag
    mock_get_text_splitter.assert_called_once_with(text_is_markdown=False)
    mock_pipeline.assert_called_once()
    assert ingestor.pipeline is not None


@patch("app.services.ingestor.SimpleKGPipeline")
@patch("app.services.text_splitter_factory.TextSplitterFactory.get_text_splitter")
@patch("app.services.embedder_factory.SentenceTransformerEmbeddings")
@patch("app.services.neo4j_llm.OpenAILLMWithTiming")
@patch("app.services.ingestor.Neo4jClient")
def test_init_pipeline_splits_summary_apart_as_markdown(
    mock_neo4j_client: MagicMock,
    mock_llm: MagicMock,
    mock_embedder: MagicMock,
    mock_get_text_splitter: MagicMock,
    mock_pipeline: MagicMock,
) -> None:
    from app.services.ingestor import Ingestor
    from app.services.prefixed_splitter import PrefixedTextSplitter

    ingestor = Ingestor(1, "doc1", "file.pdf", "")
    ingestor.summary_block = "Summary block"
    ingestor._init_pipeline()

    mock_get_text_splitter.assert_any_call(text_is_markdown=False)
    mock_get_text_splitter.assert_any_call(text_is_markdown=True)
    text_splitter = mock_pipeline.call_args.kwargs["text_splitter"]
    assert isinstance(text_splitter, PrefixedTextSplitter)
    assert text_splitter.prefix == "Summary block"


@patch("app.services.ingestor.SimpleKGPipeline")
@patch("app.services.text_splitter_factory.TextSplitterFactory.get_text_splitter")
@patch("app.services.embedder_factory.SentenceTransformerEmbeddings")
@patch("app.services.neo4j_llm.OpenAILLMWithTiming")
@patch("app.services.ingestor.Neo4jClient")
def test_init_pipeline_passes_markdown_provenance(
    mock_neo4j_client: MagicMock,
    mock_llm: MagicMock,
    mock_embedder: MagicMock,
    mock_get_text_splitter: MagicMock,
    mock_pipeline: MagicMock,
) -> None:
    from app.services.ingestor import Ingestor

    mock_neo4j_client.return_value.get_driver.return_value = MagicMock()
    mock_get_text_splitter.return_value = MagicMock()

    ingestor = Ingestor(1, "doc1", "file.pdf", "")
    ingestor.text_is_markdown = True  # as set by the MarkItDown branch of _download_file
    ingestor._init_pipeline()

    mock_get_text_splitter.assert_called_once_with(text_is_markdown=True)


@patch("app.services.ingestor.SimpleKGPipeline")
@patch("app.services.text_splitter_factory.TextSplitterFactory.get_text_splitter")
@patch("app.services.embedder_factory.SentenceTransformerEmbeddings")
@patch("app.services.ingestor.OpenAILLMWithTiming")
@patch("app.services.ingestor.Neo4jClient")
def test_init_pipeline_openai_extract_uses_ingestion_timeout(
    mock_neo4j_client: MagicMock,
    mock_llm: MagicMock,
    mock_embedder: MagicMock,
    mock_get_text_splitter: MagicMock,
    mock_pipeline: MagicMock,
) -> None:
    from app.services.ingestor import Ingestor

    mock_neo4j_client.return_value.get_driver.return_value = MagicMock()
    mock_get_text_splitter.return_value = MagicMock()

    ingestor = Ingestor(1, "doc1", "file.txt", "")
    ingestor._init_pipeline()

    assert mock_llm.call_args.kwargs["timeout"] == ingestor.llm_config.llm_ingestion_timeout_seconds


@patch("app.services.ingestor.SimpleKGPipeline")
@patch("app.services.text_splitter_factory.TextSplitterFactory.get_text_splitter")
@patch("app.services.embedder_factory.SentenceTransformerEmbeddings")
@patch("app.services.ingestor.create_chat_model")
@patch("app.services.ingestor.resolve_provider", return_value="BEDROCK")
@patch("app.services.ingestor.Neo4jClient")
def test_init_pipeline_bedrock_extract_uses_ingestion_timeout(
    mock_neo4j_client: MagicMock,
    mock_resolve_provider: MagicMock,
    mock_create_chat_model: MagicMock,
    mock_embedder: MagicMock,
    mock_get_text_splitter: MagicMock,
    mock_pipeline: MagicMock,
) -> None:
    from app.services.ingestor import Ingestor

    mock_neo4j_client.return_value.get_driver.return_value = MagicMock()
    mock_get_text_splitter.return_value = MagicMock()

    ingestor = Ingestor(1, "doc1", "file.txt", "")
    ingestor._init_pipeline()

    mock_create_chat_model.assert_called_once_with(
        ingestor.llm_config.llm_ingestor_extract,
        ingestor.llm_config,
        timeout_seconds=ingestor.llm_config.llm_ingestion_timeout_seconds,
    )


@patch("app.services.ingestor.create_chat_model")
def test_classify_with_llm_uses_ingestion_timeout(mock_create_chat_model: MagicMock) -> None:
    from app.services.ingestor import Ingestor

    ingestor = Ingestor(1, "doc1", "", "some fact-checking text sample")
    ingestor._classify_with_llm("some fact-checking text sample")

    mock_create_chat_model.assert_called_once_with(
        ingestor.llm_config.llm_ingestor_classify,
        ingestor.llm_config,
        timeout_seconds=ingestor.llm_config.llm_ingestion_timeout_seconds,
    )


def test_run_pipeline_raises_if_not_initialized() -> None:
    from app.services.ingestor import Ingestor

    ingestor = Ingestor(1, "doc1", "", "text")
    ingestor.pipeline = None

    with pytest.raises(RuntimeError, match="Pipeline not initialized"):
        asyncio.run(ingestor._run_pipeline())


def test_run_pipeline_executes() -> None:
    from app.services.ingestor import Ingestor

    ingestor = Ingestor(1, "doc1", "", "some text")

    ingestor.pipeline = MagicMock()
    ingestor.pipeline.run_async = AsyncMock()

    asyncio.run(ingestor._run_pipeline())

    ingestor.pipeline.run_async.assert_awaited_once_with(text="some text", document_metadata={"job_id": ""})


def test_run_pipeline_recreates_indexes_and_retries_on_missing_index() -> None:
    """If the hub's vector/fulltext index doesn't exist (e.g. a fresh Neo4j database, or the
    index was dropped while the driver stayed cached), the SimpleKGPipeline write can fail with
    the same class of "missing index" error the chat retriever recovers from. Ingestion should
    recover the same way: recreate the hub's indexes and retry the pipeline run once. Retrying
    is safe because the writer upserts by job_id, which is fixed for the run."""
    from app.services.ingestor import Ingestor

    ingestor = Ingestor(1, "doc1", "", "some text")
    ingestor.pipeline = MagicMock()
    missing_index_exc = Exception("There is no such vector schema index: text_vectors_1")
    ingestor.pipeline.run_async = AsyncMock(side_effect=[missing_index_exc, None])

    with patch("app.services.neo4j_client.recover_missing_vector_index") as mock_recover:
        asyncio.run(ingestor._run_pipeline())

    mock_recover.assert_called_once_with(1, missing_index_exc, "document ingestion pipeline")
    assert ingestor.pipeline.run_async.await_count == 2


def test_run_pipeline_propagates_unrelated_error() -> None:
    """Errors unrelated to a missing index must propagate without triggering index recreation."""
    from app.services.ingestor import Ingestor

    ingestor = Ingestor(1, "doc1", "", "some text")
    ingestor.pipeline = MagicMock()
    ingestor.pipeline.run_async = AsyncMock(side_effect=ValueError("boom"))

    with (
        patch("app.services.neo4j_client.recover_missing_vector_index") as mock_recover,
        pytest.raises(ValueError, match="boom"),
    ):
        asyncio.run(ingestor._run_pipeline())

    mock_recover.assert_not_called()
    assert ingestor.pipeline.run_async.await_count == 1


def test_check_url_for_fact_checking_with_known_domain() -> None:
    """URL-based classification should detect known fact-checking domains."""
    ingestor = Ingestor(
        hub_id=1,
        document_id="test",
        file_url="https://silo:9000/documents-dev/hub-1/document-123.txt",
        text="",
        original_url="https://www.thequint.com/news/webqoof/mahatma-gandhi-statue-vandalised-bangladesh-viral-video-fact-check",
    )
    result = ingestor._check_url_for_fact_checking()
    assert result is True
    assert ingestor.source_type == "fact_checking"


def test_check_url_for_fact_checking_with_factcheck_org() -> None:
    """URL-based classification should detect FactCheck.org."""
    ingestor = Ingestor(
        hub_id=1,
        document_id="test",
        file_url="https://www.factcheck.org/2024/01/some-article",
        text="",
    )
    result = ingestor._check_url_for_fact_checking()
    assert result is True
    assert ingestor.source_type == "fact_checking"


def test_check_url_for_fact_checking_with_non_fact_check_url() -> None:
    """URL-based classification should return False for non-fact-checking URLs."""
    ingestor = Ingestor(
        hub_id=1,
        document_id="test",
        file_url="https://www.nytimes.com/international/some-article",
        text="",
    )
    result = ingestor._check_url_for_fact_checking()
    assert result is False
    assert ingestor.source_type is None


def test_check_url_for_fact_checking_prefers_original_url() -> None:
    """Should check original_url before file_url."""
    ingestor = Ingestor(
        hub_id=1,
        document_id="test",
        file_url="https://silo:9000/documents-dev/hub-1/document-123.txt",
        text="",
        original_url="https://www.thequint.com/news/webqoof/mahatma-gandhi-statue-vandalised-bangladesh-viral-video-fact-check",
    )
    result = ingestor._check_url_for_fact_checking()
    assert result is True
    assert ingestor.source_type == "fact_checking"


@patch("app.services.ingestor.Neo4jClient")
def test_add_custom_metadata(mock_neo4j_client: MagicMock) -> None:
    from app.services.ingestor import Ingestor

    mock_session = MagicMock()
    mock_session.run.return_value.single.return_value = {"chunk_count": 0}
    mock_driver = MagicMock()
    mock_driver.session.return_value.__enter__.return_value = mock_session

    ingestor = Ingestor(1, "doc1", "file.txt", "")
    ingestor.driver = mock_driver
    ingestor.job_id = "1-doc1-0"

    asyncio.run(ingestor._add_custom_metadata())
    assert mock_session.run.call_count == 2

    expected_document_metadata = {
        "hub_id": 1,
        "document_id": "doc1",
        "file_url": "file.txt",
        "source_type": "unknown",
        "priority_tier": 1,
    }
    first_call, second_call = mock_session.run.call_args_list
    assert first_call.kwargs["metadata"] == expected_document_metadata
    assert first_call.kwargs["published_at"] == ""
    assert second_call.kwargs["published_at"] == ""


@patch("app.services.ingestor.Neo4jClient")
def test_add_custom_metadata_without_title(mock_neo4j_client: MagicMock) -> None:
    """Metadata should not include title when title is empty string."""
    from app.services.ingestor import Ingestor

    mock_session = MagicMock()
    mock_session.run.return_value.single.return_value = {"chunk_count": 0}
    mock_driver = MagicMock()
    mock_driver.session.return_value.__enter__.return_value = mock_session

    ingestor = Ingestor(hub_id=1, document_id="doc1", file_url="file.txt", text="", title="")
    ingestor.driver = mock_driver
    ingestor.job_id = "1-doc1-0"

    asyncio.run(ingestor._add_custom_metadata())

    # Two calls: one for Document metadata, one for Chunk published_at
    assert mock_session.run.call_count == 2
    # First call is for Document metadata
    call_kwargs = mock_session.run.call_args_list[0][1]
    metadata = call_kwargs["metadata"]
    assert "title" not in metadata


@patch("app.services.ingestor.Neo4jClient")
def test_add_custom_metadata_with_title(mock_neo4j_client: MagicMock) -> None:
    """Metadata should include title when title is provided."""
    from app.services.ingestor import Ingestor

    mock_session = MagicMock()
    mock_session.run.return_value.single.return_value = {"chunk_count": 0}
    mock_driver = MagicMock()
    mock_driver.session.return_value.__enter__.return_value = mock_session

    ingestor = Ingestor(hub_id=1, document_id="doc1", file_url="file.txt", text="", title="test title")
    ingestor.driver = mock_driver
    ingestor.job_id = "1-doc1-0"

    asyncio.run(ingestor._add_custom_metadata())

    # Two calls: one for Document metadata, one for Chunk published_at
    assert mock_session.run.call_count == 2
    # First call is for Document metadata
    call_kwargs = mock_session.run.call_args_list[0][1]
    metadata = call_kwargs["metadata"]
    assert metadata["title"] == "test title"


@patch("app.services.ingestor.Neo4jClient")
def test_add_custom_metadata_with_explicit_priority_tier(mock_neo4j_client: MagicMock) -> None:
    mock_session = MagicMock()
    mock_session.run.return_value.single.return_value = {"chunk_count": 0}
    mock_driver = MagicMock()
    mock_driver.session.return_value.__enter__.return_value = mock_session

    ingestor = Ingestor(hub_id=1, document_id="doc1", file_url="file.txt", text="", priority_tier=2)
    ingestor.driver = mock_driver
    ingestor.job_id = "1-doc1-0"

    asyncio.run(ingestor._add_custom_metadata())

    call_kwargs = mock_session.run.call_args_list[0][1]
    metadata = call_kwargs["metadata"]
    assert metadata["priority_tier"] == 2


@patch("app.services.ingestor.Neo4jClient")
def test_add_custom_metadata_copies_priority_tier_onto_chunks(mock_neo4j_client: MagicMock) -> None:
    """The recency-first pre-filter only sees chunk properties, so the tier must land on chunks too."""
    mock_session = MagicMock()
    mock_session.run.return_value.single.return_value = {"chunk_count": 0}
    mock_driver = MagicMock()
    mock_driver.session.return_value.__enter__.return_value = mock_session

    ingestor = Ingestor(hub_id=1, document_id="doc1", file_url="file.txt", text="", priority_tier=2)
    ingestor.driver = mock_driver
    ingestor.job_id = "1-doc1-0"

    asyncio.run(ingestor._add_custom_metadata())

    chunk_call = mock_session.run.call_args_list[1]
    assert "SET c.priority_tier = $priority_tier" in chunk_call.args[0]
    assert chunk_call.kwargs["priority_tier"] == 2


@patch("app.services.ingestor.Neo4jClient")
def test_add_custom_metadata_includes_document_type(mock_neo4j_client: MagicMock) -> None:
    mock_session = MagicMock()
    mock_session.run.return_value.single.return_value = {"chunk_count": 0}
    mock_driver = MagicMock()
    mock_driver.session.return_value.__enter__.return_value = mock_session

    ingestor = Ingestor(hub_id=1, document_id="doc1", file_url="file.txt", text="", document_type="contribution")
    ingestor.driver = mock_driver
    ingestor.job_id = "1-doc1-0"

    asyncio.run(ingestor._add_custom_metadata())

    call_kwargs = mock_session.run.call_args_list[0][1]
    metadata = call_kwargs["metadata"]
    assert metadata["document_type"] == "contribution"


@patch("app.services.ingestor.Neo4jClient")
def test_add_custom_metadata_omits_empty_document_type(mock_neo4j_client: MagicMock) -> None:
    mock_session = MagicMock()
    mock_session.run.return_value.single.return_value = {"chunk_count": 0}
    mock_driver = MagicMock()
    mock_driver.session.return_value.__enter__.return_value = mock_session

    ingestor = Ingestor(hub_id=1, document_id="doc1", file_url="file.txt", text="")
    ingestor.driver = mock_driver
    ingestor.job_id = "1-doc1-0"

    asyncio.run(ingestor._add_custom_metadata())

    call_kwargs = mock_session.run.call_args_list[0][1]
    metadata = call_kwargs["metadata"]
    assert "document_type" not in metadata


def test_constructor_defaults_text_is_markdown_to_false() -> None:
    ingestor = Ingestor(1, "doc1", "", "Some raw text")

    assert ingestor.text_is_markdown is False


def test_constructor_honors_caller_asserted_text_is_markdown() -> None:
    ingestor = Ingestor(1, "doc1", "", "# Heading\n\nSome markdown", text_is_markdown=True)

    assert ingestor.text_is_markdown is True


@patch("app.services.ingestor.requests.get")
def test_download_file_overrides_caller_asserted_text_is_markdown(mock_get: MagicMock) -> None:
    """file_url ingestion always derives the flag from the extension, regardless of the constructor default."""
    mock_get.return_value = mock_get_file(content=b"plain text content")

    ingestor = Ingestor(
        hub_id=1,
        document_id="doc1",
        file_url="https://example.com/file.txt",
        text="",
        text_is_markdown=True,
    )
    asyncio.run(ingestor._download_file())

    assert ingestor.text_is_markdown is False


@patch.object(Ingestor, "_extract_topics", new_callable=AsyncMock)
@patch.object(Ingestor, "_add_custom_metadata", new_callable=AsyncMock)
@patch.object(Ingestor, "_run_pipeline", new_callable=AsyncMock)
@patch.object(Ingestor, "_init_pipeline")
@patch.object(Ingestor, "_download_file", new_callable=AsyncMock)
@patch.object(Ingestor, "_delete_existing_document")
@patch.object(Ingestor, "_init_driver")
def test_run_text_input(
    mock_init_driver: MagicMock,
    mock_delete_existing_document: MagicMock,
    mock_download_file: AsyncMock,
    mock_init_pipeline: MagicMock,
    mock_run_pipeline: MagicMock,
    mock_add_metadata: MagicMock,
    mock_extract_topics: AsyncMock,
) -> None:
    ingestor = Ingestor(1, "doc1", "", "Some raw text")
    asyncio.run(ingestor.run())

    mock_init_driver.assert_called_once()
    mock_delete_existing_document.assert_called_once()
    mock_download_file.assert_not_awaited()
    mock_extract_topics.assert_awaited_once()
    mock_init_pipeline.assert_called_once()
    mock_run_pipeline.assert_awaited_once()
    mock_add_metadata.assert_awaited_once()


@patch.object(Ingestor, "_extract_entity_glossary")
@patch.object(Ingestor, "_classify_source_type")
@patch.object(Ingestor, "_extract_topics", new_callable=AsyncMock)
@patch.object(Ingestor, "_add_custom_metadata", new_callable=AsyncMock)
@patch.object(Ingestor, "_run_pipeline", new_callable=AsyncMock)
@patch.object(Ingestor, "_init_pipeline")
@patch.object(Ingestor, "_download_file", new_callable=AsyncMock)
@patch.object(Ingestor, "_delete_existing_document")
@patch.object(Ingestor, "_init_driver")
def test_run_prepends_summary_to_downloaded_text(
    mock_init_driver: MagicMock,
    mock_delete_existing_document: MagicMock,
    mock_download_file: AsyncMock,
    mock_init_pipeline: MagicMock,
    mock_run_pipeline: MagicMock,
    mock_add_metadata: MagicMock,
    mock_extract_topics: AsyncMock,
    mock_classify: MagicMock,
    mock_extract_glossary: MagicMock,
) -> None:
    ingestor = Ingestor(1, "doc1", "https://example.com/file.pdf", "", summary="  Context from the team  ")

    async def download() -> None:
        ingestor.text = "Document body"

    mock_download_file.side_effect = download
    asyncio.run(ingestor.run())

    assert ingestor.text == f"{DOCUMENT_SUMMARY_LABEL}\n\nContext from the team\n\nDocument body"
    mock_run_pipeline.assert_awaited_once()


@patch.object(Ingestor, "_extract_entity_glossary")
@patch.object(Ingestor, "_classify_source_type")
@patch.object(Ingestor, "_extract_topics", new_callable=AsyncMock)
@patch.object(Ingestor, "_add_custom_metadata", new_callable=AsyncMock)
@patch.object(Ingestor, "_run_pipeline", new_callable=AsyncMock)
@patch.object(Ingestor, "_init_pipeline")
@patch.object(Ingestor, "_download_file", new_callable=AsyncMock)
@patch.object(Ingestor, "_delete_existing_document")
@patch.object(Ingestor, "_init_driver")
def test_run_ingests_summary_of_document_without_text(
    mock_init_driver: MagicMock,
    mock_delete_existing_document: MagicMock,
    mock_download_file: AsyncMock,
    mock_init_pipeline: MagicMock,
    mock_run_pipeline: MagicMock,
    mock_add_metadata: MagicMock,
    mock_extract_topics: AsyncMock,
    mock_classify: MagicMock,
    mock_extract_glossary: MagicMock,
) -> None:
    # a scanned PDF yields no text, but the summary written about it is still worth ingesting
    ingestor = Ingestor(1, "doc1", "https://example.com/scanned.pdf", "", summary="Context from the team")
    asyncio.run(ingestor.run())

    assert ingestor.text.startswith(DOCUMENT_SUMMARY_LABEL)
    mock_run_pipeline.assert_awaited_once()


@patch.object(Ingestor, "_extract_topics", new_callable=AsyncMock)
@patch.object(Ingestor, "_run_pipeline", new_callable=AsyncMock, side_effect=RuntimeError("pipeline failed"))
@patch.object(Ingestor, "_init_pipeline")
@patch.object(Ingestor, "_delete_existing_document")
@patch.object(Ingestor, "_init_driver")
def test_run_propagates_pipeline_failure(
    mock_init_driver: MagicMock,
    mock_delete_existing_document: MagicMock,
    mock_init_pipeline: MagicMock,
    mock_run_pipeline: MagicMock,
    mock_extract_topics: AsyncMock,
) -> None:
    ingestor = Ingestor(1, "doc1", "", "Some raw text")
    with pytest.raises(IngestionError, match="Ingestion failed for document doc1") as exc_info:
        asyncio.run(ingestor.run())

    assert isinstance(exc_info.value.__cause__, RuntimeError)
    mock_extract_topics.assert_awaited_once()
    mock_run_pipeline.assert_awaited_once()


@patch.object(Ingestor, "_init_pipeline")
@patch.object(Ingestor, "_download_file", new_callable=AsyncMock)
@patch.object(Ingestor, "_delete_existing_document")
@patch.object(Ingestor, "_init_driver")
def test_run_raises_validation_error_for_blank_text(
    mock_init_driver: MagicMock,
    mock_delete_existing_document: MagicMock,
    mock_download_file: AsyncMock,
    mock_init_pipeline: MagicMock,
) -> None:
    # simulates a scanned/image-only PDF where markitdown extracts no text
    ingestor = Ingestor(1, "doc1", "https://example.com/scanned.pdf", "")
    with pytest.raises(IngestionValidationError, match="doc1") as exc_info:
        asyncio.run(ingestor.run())

    assert exc_info.value.code == ValidationCode.NO_TEXT_FOUND
    mock_init_pipeline.assert_not_called()


@patch("app.core.ingestion_validation.Config")
@patch.object(Ingestor, "_init_pipeline")
@patch.object(Ingestor, "_download_file", new_callable=AsyncMock)
@patch.object(Ingestor, "_delete_existing_document")
@patch.object(Ingestor, "_init_driver")
def test_run_raises_validation_error_for_oversized_text(
    mock_init_driver: MagicMock,
    mock_delete_existing_document: MagicMock,
    mock_download_file: AsyncMock,
    mock_init_pipeline: MagicMock,
    mock_config: MagicMock,
) -> None:
    mock_config.return_value.max_text_ingestion_size = 5

    ingestor = Ingestor(1, "doc1", "", "way more than five tokens of text right here")
    with (
        patch.object(Ingestor, "_classify_source_type") as mock_classify,
        patch.object(Ingestor, "_extract_topics") as mock_extract_topics,
        patch.object(Ingestor, "_extract_entity_glossary") as mock_extract_glossary,
    ):
        with pytest.raises(IngestionValidationError, match="doc1") as exc_info:
            asyncio.run(ingestor.run())

        mock_classify.assert_not_called()
        mock_extract_topics.assert_not_called()
        mock_extract_glossary.assert_not_called()

    assert exc_info.value.code == ValidationCode.TEXT_TOO_LARGE
    mock_init_pipeline.assert_not_called()


@patch("app.services.ingestor.TopicExtractor")
async def test_extract_topics_populates_topics(mock_topic_extractor: MagicMock) -> None:
    mock_topic_extractor.return_value.extract = AsyncMock(return_value=["Elections", "Climate Policy"])

    ingestor = Ingestor(1, "doc1", "", "Some raw text", existing_topics=["Elections"])
    await ingestor._extract_topics()

    assert ingestor.topics == ["Elections", "Climate Policy"]
    mock_topic_extractor.return_value.extract.assert_called_once_with("Some raw text", ["Elections"])


@patch("app.services.ingestor.TopicExtractor")
async def test_extract_topics_is_resilient(mock_topic_extractor: MagicMock) -> None:
    mock_topic_extractor.return_value.extract = AsyncMock(side_effect=RuntimeError("llm down"))

    ingestor = Ingestor(1, "doc1", "", "Some raw text")
    await ingestor._extract_topics()

    assert ingestor.topics == []


@patch("app.services.ingestor.Config")
@patch("app.services.ingestor.TopicExtractor")
async def test_extract_topics_respects_disabled_flag(mock_topic_extractor: MagicMock, mock_config: MagicMock) -> None:
    mock_config.return_value.topic_extraction_enabled = False

    ingestor = Ingestor(1, "doc1", "", "Some raw text")
    await ingestor._extract_topics()

    assert ingestor.topics == []
    mock_topic_extractor.assert_not_called()


# ---------------------------------------------------------------------------
# extraction prompt
# ---------------------------------------------------------------------------


def test_default_schema_guidance_includes_causal_relationship_types() -> None:
    ingestor = Ingestor(1, "doc1", "", "text")
    guidance = ingestor._schema_guidance_for_source_type()
    for rel_type in ("CAUSES", "PREVENTS", "ENABLES", "REQUIRES", "CONDITION_FOR"):
        assert rel_type in guidance


def test_legal_schema_guidance_includes_conditional_relationship_types() -> None:
    ingestor = Ingestor(1, "doc1", "", "text")
    ingestor.source_type = "legal"
    guidance = ingestor._schema_guidance_for_source_type()
    assert "REQUIRES" in guidance
    assert "CONDITION_FOR" in guidance


def test_extraction_prompt_contains_causal_rules() -> None:
    ingestor = Ingestor(1, "doc1", "", "text")
    prompt = ingestor._build_extraction_prompt()

    assert "CAUSAL & CONDITIONAL RELATIONSHIP RULES" in prompt
    for modality in ('"asserted"', '"hedged"', '"hypothetical"', '"negated"'):
        assert modality in prompt
    assert '"evidence"' in prompt
    assert "NEVER infer causality from temporal sequence" in prompt


def test_extraction_prompt_contains_layout_rules() -> None:
    ingestor = Ingestor(1, "doc1", "", "text")
    prompt = ingestor._build_extraction_prompt()

    assert "LAYOUT RULES" in prompt
    assert "[photo caption]" in prompt
    assert "[sidebar]" in prompt


def test_extraction_prompt_survives_pipeline_format_pass() -> None:
    """SimpleKGPipeline runs a second str.format(text=...) pass over the template:
    the {text} placeholder must survive the f-string, JSON braces must stay doubled,
    and no stray single braces may remain anywhere in the prompt."""
    ingestor = Ingestor(1, "doc1", "", "text")
    prompt = ingestor._build_extraction_prompt()

    assert "{text}" in prompt
    assert '{{"type": "CAUSES"' in prompt

    formatted = prompt.format(text="sample input")
    assert "sample input" in formatted
    assert '{"type": "CAUSES"' in formatted


def test_extraction_prompt_includes_fact_checking_caveat_only_for_fact_checking() -> None:
    ingestor = Ingestor(1, "doc1", "", "text")
    assert "FACT-CHECKING SOURCE DETECTED" not in ingestor._build_extraction_prompt()

    ingestor.source_type = "fact_checking"
    assert "FACT-CHECKING SOURCE DETECTED" in ingestor._build_extraction_prompt()


def test_extraction_prompt_requires_name_property() -> None:
    ingestor = Ingestor(1, "doc1", "", "text")
    prompt = ingestor._build_extraction_prompt()
    assert 'Every node MUST have a "name" property' in prompt


# ---------------------------------------------------------------------------
# entity glossary
# ---------------------------------------------------------------------------


def test_extraction_prompt_has_no_glossary_block_when_empty() -> None:
    ingestor = Ingestor(1, "doc1", "", "text")
    assert "KNOWN ENTITIES" not in ingestor._build_extraction_prompt()


def test_extraction_prompt_includes_glossary_entries() -> None:
    from app.services.entity_glossary import GlossaryEntry

    ingestor = Ingestor(1, "doc1", "", "text")
    ingestor.entity_glossary = [
        GlossaryEntry(name="Misoprostol", label="Medication", aliases=["miso", "the pills"]),
        GlossaryEntry(name="ACME Corp", label="Organization"),
    ]
    prompt = ingestor._build_extraction_prompt()

    assert "KNOWN ENTITIES" in prompt
    assert '- "Misoprostol" [Medication] (also mentioned as: "miso", "the pills")' in prompt
    assert '- "ACME Corp" [Organization]' in prompt
    assert "MUST use the canonical name and label EXACTLY" in prompt
    assert "honorific" not in prompt.lower()


def test_extraction_prompt_with_glossary_survives_pipeline_format_pass() -> None:
    """Glossary content containing literal braces must not break the str.format(text=...)
    pass that SimpleKGPipeline runs over the assembled template."""
    from app.services.entity_glossary import GlossaryEntry

    ingestor = Ingestor(1, "doc1", "", "text")
    ingestor.entity_glossary = [GlossaryEntry(name="{{weird}} name", label="Concept", aliases=["{alias}"])]
    prompt = ingestor._build_extraction_prompt()

    formatted = prompt.format(text="sample input")
    assert "sample input" in formatted
    assert '"{{weird}} name" [Concept]' in formatted
    assert '"{alias}"' in formatted


@patch("app.services.ingestor.EntityGlossaryExtractor")
def test_extract_entity_glossary_populates_glossary(mock_extractor: MagicMock) -> None:
    from app.services.entity_glossary import GlossaryEntry

    entries = [GlossaryEntry(name="Misoprostol", label="Medication")]
    mock_extractor.return_value.extract.return_value = entries

    ingestor = Ingestor(1, "doc1", "", "Some raw text")
    ingestor._extract_entity_glossary()

    assert ingestor.entity_glossary == entries
    mock_extractor.return_value.extract.assert_called_once_with(
        "Some raw text", ingestor._schema_guidance_for_source_type()
    )


@patch("app.services.ingestor.Config")
@patch("app.services.ingestor.EntityGlossaryExtractor")
def test_extract_entity_glossary_respects_disabled_flag(mock_extractor: MagicMock, mock_config: MagicMock) -> None:
    mock_config.return_value.entity_glossary_enabled = False

    ingestor = Ingestor(1, "doc1", "", "Some raw text")
    ingestor._extract_entity_glossary()

    assert ingestor.entity_glossary == []
    mock_extractor.assert_not_called()
