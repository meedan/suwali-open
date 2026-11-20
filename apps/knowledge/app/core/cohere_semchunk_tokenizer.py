# Bedrock embed model_id -> Hugging Face tokenizer repo aligned with Cohere Embed v3 tokenization
BEDROCK_COHERE_EMBED_MODEL_ID_TO_HF_TOKENIZER: dict[str, str] = {
    "cohere.embed-multilingual-v3": "Cohere/Cohere-embed-multilingual-v3.0",
    "cohere.embed-english-v3": "Cohere/Cohere-embed-english-v3.0",
}


def hf_tokenizer_repo_for_bedrock_cohere_embed(embedding_model_name: str) -> str | None:
    return BEDROCK_COHERE_EMBED_MODEL_ID_TO_HF_TOKENIZER.get(embedding_model_name)
