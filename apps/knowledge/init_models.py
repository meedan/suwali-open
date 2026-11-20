import logging
import os
from pathlib import Path
from typing import Any, Literal

import nltk
from dotenv import load_dotenv
from loguru import logger
from sentence_transformers import SentenceTransformer
from transformers import AutoTokenizer

from app.core.cohere_semchunk_tokenizer import hf_tokenizer_repo_for_bedrock_cohere_embed
from app.core.config import (
    Config,
    embed_api_profile_matches_primary_embedding,
    resolved_embed_api_embedding_model_name,
    resolved_embed_api_embedding_provider,
)

load_dotenv(override=True)
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["TRANSFORMERS_OFFLINE"] = "0"
logging.basicConfig(level=logging.INFO)


def _prefetch_embedding_assets(
    *,
    provider: Literal["SBERT", "OPENAI", "BEDROCK_COHERE"],
    model_name: str,
    models_dir: str,
    sentence_transformer_config: dict[str, Any],
) -> None:
    if provider == "SBERT":
        model = SentenceTransformer(model_name, **sentence_transformer_config)
        model.encode(["warmup"])
        logger.info(f"SBERT model '{model_name}' loaded and warmed")
    elif provider == "BEDROCK_COHERE":
        hf_id = hf_tokenizer_repo_for_bedrock_cohere_embed(model_name)
        if hf_id is not None:
            AutoTokenizer.from_pretrained(hf_id, cache_dir=models_dir, trust_remote_code=False)  # type: ignore[no-untyped-call]
            logger.info(f"Cohere HF tokenizer '{hf_id}' cached under {models_dir}")
        else:
            logger.info(
                f"No bundled HF tokenizer mapping for embedding_model_name={model_name!r}; "
                "skipping AutoTokenizer prefetch"
            )
    else:
        logger.info(f"Skipping local SentenceTransformer download (embedding_model_provider={provider})")


def main() -> None:
    config = Config()

    app_base = Path(__file__).parent.resolve()
    models_dir = f"{app_base}/.models"
    os.makedirs(models_dir, exist_ok=True)
    sentence_transformer_config = {
        "device": "cpu",
        "trust_remote_code": False,
        "cache_folder": models_dir,
    }

    _prefetch_embedding_assets(
        provider=config.embedding_model_provider,
        model_name=config.embedding_model_name,
        models_dir=models_dir,
        sentence_transformer_config=sentence_transformer_config,
    )

    if not embed_api_profile_matches_primary_embedding(config):
        _prefetch_embedding_assets(
            provider=resolved_embed_api_embedding_provider(config),
            model_name=resolved_embed_api_embedding_model_name(config),
            models_dir=models_dir,
            sentence_transformer_config=sentence_transformer_config,
        )

    nltk.data.path.append(models_dir)
    nltk.download("punkt_tab", download_dir=models_dir)
    logger.info("NLTK punkt_tab model downloaded")

    # NLTK models for Named Entity Recognition (used by NLTKEntityExtractor)
    nltk.download("averaged_perceptron_tagger_eng", download_dir=models_dir)
    nltk.download("maxent_ne_chunker_tab", download_dir=models_dir)
    nltk.download("words", download_dir=models_dir)
    logger.info("NLTK NER models downloaded")

    logger.info("Model initialization complete")


if __name__ == "__main__":
    main()
