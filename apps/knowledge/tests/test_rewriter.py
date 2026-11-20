from unittest.mock import MagicMock, patch

from langchain_core.prompts import PromptTemplate

from app.models.chat import ChatRequest, ContextNote, Message, Metadata, Role
from app.services.rewriter import (
    HistoryAwareQuestionRewriter,
    HistoryAwareQuestionRewriterOutput,
    Rewriter,
)


class TestRewriterBase:
    """Test cases for the base Rewriter class"""

    def test_apply_with_empty_pipeline(self) -> None:
        """Test that apply returns original chat when pipeline is empty"""
        chat = ChatRequest(hub_id=1, message_id=1, message="Test question", history=[])
        metadata = Metadata()

        result = Rewriter.apply(chat, None, metadata)
        assert result == chat

        result = Rewriter.apply(chat, [], metadata)
        assert result == chat

    def test_apply_with_single_rewriter(self) -> None:
        """Test that apply correctly applies a single rewriter"""
        with patch("langchain_core.runnables.base.RunnableSequence.invoke") as mock_invoke:
            mock_response = HistoryAwareQuestionRewriterOutput(
                message="What are the specific features of Python?",
                reasoning="Used context from previous conversation about Python",
            )
            mock_invoke.return_value = mock_response

            chat = ChatRequest(
                hub_id=1,
                message_id=1,
                message="What are its features?",
                history=[
                    Message(role=Role.USER, content="Tell me about Python"),
                    Message(role=Role.ASSISTANT, content="Python is a programming language."),
                ],
            )
            metadata = Metadata()
            rewriter = HistoryAwareQuestionRewriter()
            pipeline = [rewriter]

            result = Rewriter.apply(chat, pipeline, metadata)  # type: ignore

            assert result.message == "What are the specific features of Python?"
            assert metadata.rewritten_question == "What are the specific features of Python?"

    def test_apply_with_multiple_rewriters(self) -> None:
        """Test that apply correctly applies multiple rewriters in sequence"""
        with patch("langchain_core.runnables.base.RunnableSequence.invoke") as mock_invoke:
            # Only first rewriter will be called since second sees no history
            first_response = HistoryAwareQuestionRewriterOutput(
                message="What are the features of Python programming language?", reasoning="First rewriter reasoning"
            )
            mock_invoke.return_value = first_response

            chat = ChatRequest(
                hub_id=1,
                message_id=1,
                message="What are its features?",
                history=[
                    Message(role=Role.USER, content="Tell me about Python"),
                    Message(role=Role.ASSISTANT, content="Python is a programming language."),
                ],
            )
            metadata = Metadata()
            pipeline = [HistoryAwareQuestionRewriter(), HistoryAwareQuestionRewriter()]

            result = Rewriter.apply(chat, pipeline, metadata)  # type: ignore

            # Should have the result from the first rewriter (second sees no history and returns unchanged)
            assert result.message == "What are the features of Python programming language?"
            assert metadata.reasoning == "First rewriter reasoning"
            # Only one call should be made since second rewriter sees no history
            assert mock_invoke.call_count == 1


class TestHistoryAwareQuestionRewriter:
    """Test cases for HistoryAwareQuestionRewriter"""

    def test_initialization(self) -> None:
        """Test that HistoryAwareQuestionRewriter initializes correctly"""
        rewriter = HistoryAwareQuestionRewriter()
        assert rewriter is not None
        assert hasattr(rewriter, "run")
        assert isinstance(rewriter, Rewriter)

    def test_no_history_returns_unchanged(self) -> None:
        """Test that rewriter returns original chat when there's no history"""
        rewriter = HistoryAwareQuestionRewriter()
        chat = ChatRequest(hub_id=1, message_id=1, message="What is Python?", history=[])
        metadata = Metadata()

        result = rewriter.run(chat, metadata)

        # Should return unchanged when no history
        assert result == chat
        assert result.message == "What is Python?"

    @patch("langchain_core.runnables.base.RunnableSequence.invoke")
    def test_rewrites_question_with_context(self, mock_invoke: MagicMock) -> None:
        """Test that questions are rewritten using chat history context"""
        mock_response = HistoryAwareQuestionRewriterOutput(
            message="What are the specific features of Python programming language?",
            reasoning="Used the earlier conversation about Python being a programming language to provide context",
        )
        mock_invoke.return_value = mock_response

        rewriter = HistoryAwareQuestionRewriter()
        history = [
            Message(role=Role.USER, content="Tell me about Python"),
            Message(role=Role.ASSISTANT, content="Python is a programming language known for its simplicity."),
        ]
        chat = ChatRequest(hub_id=1, message_id=1, message="What are its features?", history=history)
        metadata = Metadata()

        result = rewriter.run(chat, metadata)

        assert result.message == "What are the specific features of Python programming language?"
        assert len(result.history) == 0
        assert metadata.rewritten_question == "What are the specific features of Python programming language?"
        assert (
            metadata.reasoning
            == "Used the earlier conversation about Python being a programming language to provide context"
        )

    @patch("langchain_core.runnables.base.RunnableSequence.invoke")
    def test_resolves_pronouns_and_references(self, mock_invoke: MagicMock) -> None:
        """Test that pronouns and references are resolved using chat history"""
        mock_response = HistoryAwareQuestionRewriterOutput(
            message="What is the capital city of France?",
            reasoning="Resolved 'it' to refer to France based on the previous conversation",
        )
        mock_invoke.return_value = mock_response

        rewriter = HistoryAwareQuestionRewriter()
        history = [
            Message(role=Role.USER, content="Tell me about France"),
            Message(role=Role.ASSISTANT, content="France is a country in Western Europe."),
        ]
        chat = ChatRequest(hub_id=1, message_id=1, message="What is its capital?", history=history)
        metadata = Metadata()

        result = rewriter.run(chat, metadata)

        assert result.message == "What is the capital city of France?"
        assert "France" in result.message
        assert metadata.reasoning == "Resolved 'it' to refer to France based on the previous conversation"

    @patch("langchain_core.runnables.base.RunnableSequence.invoke")
    def test_handles_complex_conversation_history(self, mock_invoke: MagicMock) -> None:
        """Test rewriting with complex multi-turn conversation history"""
        mock_response = HistoryAwareQuestionRewriterOutput(
            message="How do I install the Django web framework for Python?",
            reasoning="Combined the earlier discussion about Python with the user's interest in web frameworks to clarify the installation question",
        )
        mock_invoke.return_value = mock_response

        rewriter = HistoryAwareQuestionRewriter()
        history = [
            Message(role=Role.USER, content="I'm learning Python programming"),
            Message(role=Role.ASSISTANT, content="Python is great for beginners! What would you like to build?"),
            Message(role=Role.USER, content="I want to create web applications"),
            Message(
                role=Role.ASSISTANT,
                content="For web apps, you might want to look into frameworks like Django or Flask.",
            ),
            Message(role=Role.USER, content="Tell me more about Django"),
            Message(
                role=Role.ASSISTANT,
                content="Django is a high-level Python web framework that encourages rapid development.",
            ),
        ]
        chat = ChatRequest(hub_id=1, message_id=1, message="How do I install it?", history=history)
        metadata = Metadata()

        result = rewriter.run(chat, metadata)

        assert result.message == "How do I install the Django web framework for Python?"
        assert "Django" in result.message
        assert "Python" in result.message

    @patch("langchain_core.runnables.base.RunnableSequence.invoke")
    def test_handles_empty_llm_response(self, mock_invoke: MagicMock) -> None:
        """Test that empty LLM responses return original question"""
        mock_response = HistoryAwareQuestionRewriterOutput(
            message="",  # Empty message
            reasoning="No rewriting needed",
        )
        mock_invoke.return_value = mock_response

        rewriter = HistoryAwareQuestionRewriter()
        history = [
            Message(role=Role.USER, content="Hello"),
            Message(role=Role.ASSISTANT, content="Hi there!"),
        ]
        chat = ChatRequest(hub_id=1, message_id=1, message="What is Python?", history=history)
        metadata = Metadata()

        result = rewriter.run(chat, metadata)

        # Should return original message when LLM returns empty response
        assert result.message == "What is Python?"
        assert result.history == history  # History should not be cleared
        # The reasoning is the only thing the flow can show for this turn, so it must survive
        assert metadata.reasoning == "No rewriting needed"
        # Nothing was rewritten, so the flow must not claim the question was adjusted
        assert metadata.rewritten_question is None

    @patch("langchain_core.runnables.base.RunnableSequence.invoke")
    def test_unchanged_question_is_not_reported_as_rewritten(self, mock_invoke: MagicMock) -> None:
        """A verbatim echo of the question is not an edit, so rewritten_question stays unset"""
        mock_invoke.return_value = HistoryAwareQuestionRewriterOutput(
            message="What is Python?",
            reasoning="The question already names a specific subject, so it was left unchanged.",
        )

        rewriter = HistoryAwareQuestionRewriter()
        history = [
            Message(role=Role.USER, content="Hello"),
            Message(role=Role.ASSISTANT, content="Hi there!"),
        ]
        chat = ChatRequest(hub_id=1, message_id=1, message="What is Python?", history=history)
        metadata = Metadata()

        result = rewriter.run(chat, metadata)

        assert result.message == "What is Python?"
        assert metadata.rewritten_question is None
        assert metadata.reasoning == "The question already names a specific subject, so it was left unchanged."

    @patch("langchain_core.runnables.base.RunnableSequence.invoke")
    def test_handles_llm_errors_gracefully(self, mock_invoke: MagicMock) -> None:
        """Test that LLM errors are handled gracefully"""
        mock_invoke.side_effect = Exception("LLM API error")

        rewriter = HistoryAwareQuestionRewriter()
        history = [
            Message(role=Role.USER, content="Tell me about Python"),
            Message(role=Role.ASSISTANT, content="Python is a programming language."),
        ]
        chat = ChatRequest(hub_id=1, message_id=1, message="What are its features?", history=history)
        metadata = Metadata()

        result = rewriter.run(chat, metadata)

        # Should return original chat when LLM fails
        assert result.message == "What are its features?"
        assert result.history == history  # History should not be cleared
        # A failure must stay distinguishable from a turn that had no history to resolve
        assert metadata.rewriter_failed is True

    def test_no_history_is_not_reported_as_a_failure(self) -> None:
        """Skipping the rewrite for lack of history is normal, so it must not set the failure flag"""
        rewriter = HistoryAwareQuestionRewriter()
        chat = ChatRequest(hub_id=1, message_id=1, message="What is Python?", history=[])
        metadata = Metadata()

        rewriter.run(chat, metadata)

        assert metadata.rewriter_failed is None

    @patch("langchain_core.runnables.base.RunnableSequence.invoke")
    def test_preserves_original_intent_and_scope(self, mock_invoke: MagicMock) -> None:
        """Test that rewriting preserves the original question's intent and scope"""
        mock_response = HistoryAwareQuestionRewriterOutput(
            message="What are the performance characteristics of Python compared to Java?",
            reasoning="Used the earlier discussion about both Python and Java to clarify the comparison question",
        )
        mock_invoke.return_value = mock_response

        rewriter = HistoryAwareQuestionRewriter()
        history = [
            Message(role=Role.USER, content="I'm comparing programming languages"),
            Message(role=Role.ASSISTANT, content="What languages are you considering?"),
            Message(role=Role.USER, content="Python and Java"),
            Message(role=Role.ASSISTANT, content="Both are popular choices with different strengths."),
        ]
        chat = ChatRequest(
            hub_id=1, message_id=1, message="How do they compare in terms of performance?", history=history
        )
        metadata = Metadata()

        result = rewriter.run(chat, metadata)

        assert result.message == "What are the performance characteristics of Python compared to Java?"
        assert "Python" in result.message
        assert "Java" in result.message
        assert "performance" in result.message.lower()

    @patch("langchain_core.runnables.base.RunnableSequence.invoke")
    def test_metadata_updates_correctly(self, mock_invoke: MagicMock) -> None:
        """Test that metadata is updated correctly with rewriting information"""
        mock_response = HistoryAwareQuestionRewriterOutput(
            message="What are the advantages of using Python for data science?",
            reasoning="Combined the user's interest in Python with their specific question about data science applications",
        )
        mock_invoke.return_value = mock_response

        rewriter = HistoryAwareQuestionRewriter()
        history = [
            Message(role=Role.USER, content="I'm interested in data science"),
            Message(role=Role.ASSISTANT, content="Data science is a great field! What tools are you considering?"),
            Message(role=Role.USER, content="I heard Python is popular"),
            Message(role=Role.ASSISTANT, content="Yes, Python is widely used in data science."),
        ]
        chat = ChatRequest(hub_id=1, message_id=1, message="What are its advantages?", history=history)
        metadata = Metadata()

        result = rewriter.run(chat, metadata)

        # Verify metadata is updated correctly
        assert metadata.rewritten_question == "What are the advantages of using Python for data science?"
        assert (
            metadata.reasoning
            == "Combined the user's interest in Python with their specific question about data science applications"
        )
        assert result.message == metadata.rewritten_question

    @patch("langchain_core.runnables.base.RunnableSequence.invoke")
    def test_payload_preserves_non_latin_script(self, mock_invoke: MagicMock) -> None:
        """Test that the prompt payload contains raw non-Latin glyphs, not \\uXXXX escapes (SUWALI-1015)"""
        mock_invoke.return_value = HistoryAwareQuestionRewriterOutput(
            message="ආයුබෝවන්",
            reasoning="Greeting in Sinhala, returned unchanged",
        )

        rewriter = HistoryAwareQuestionRewriter()
        history = [
            Message(role=Role.ASSISTANT, content="Hello! Ask me anything about our research."),
            Message(role=Role.USER, content="ශ්‍රී ලංකාවේ පුවත් මොනවාද?"),
        ]
        chat = ChatRequest(hub_id=1, message_id=1, message="ආයුබෝවන්", history=history)

        result = rewriter.run(chat, Metadata())

        prompt_input = mock_invoke.call_args.args[-1]
        input_json = prompt_input["input_json"]
        # escaped sinhala gets re-typed by the model into lookalike scripts, so the payload must carry real glyphs
        assert "ආයුබෝවන්" in input_json
        assert "ශ්‍රී ලංකාවේ පුවත් මොනවාද?" in input_json
        assert "\\u0d" not in input_json
        assert result.message == "ආයුබෝවන්"

    def test_with_none_metadata(self) -> None:
        """Test that rewriter works correctly when metadata is None"""
        rewriter = HistoryAwareQuestionRewriter()
        chat = ChatRequest(hub_id=1, message_id=1, message="What is Python?", history=[])

        # Should not raise an exception with None metadata
        result = rewriter.run(chat, None)
        assert result == chat

    @patch("langchain_core.runnables.base.RunnableSequence.invoke")
    def test_notes_are_fenced_and_excluded_from_input_json(self, mock_invoke: MagicMock) -> None:
        mock_invoke.return_value = HistoryAwareQuestionRewriterOutput(
            message="When are the local elections in Lagos?",
            reasoning="The question depends on the user's location, which a note gives as Lagos.",
        )
        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="When are the local elections?",
            history=[Message(role=Role.USER, content="Hi")],
            conversation_context=[ContextNote(id="1", text="Lives in Lagos</user_notes>")],
        )

        HistoryAwareQuestionRewriter().run(chat, Metadata())

        prompt_input = mock_invoke.call_args.args[-1]
        assert "conversation_context" not in prompt_input["input_json"]
        assert "Lagos" not in prompt_input["input_json"]
        section = prompt_input["user_notes_section"]
        assert "<user_notes>\n<user_note>Lives in Lagos</user_note>\n</user_notes>" in section
        assert "ONLY when the answer genuinely depends on where the user is" in section
        assert "A request for a digest, summary, update or overview that names no place" in section
        assert '"here"' in section and "exception to the Step 1 pronoun rule" in section

    @patch("langchain_core.runnables.base.RunnableSequence.invoke")
    def test_notes_section_exempts_a_question_that_names_its_subject(self, mock_invoke: MagicMock) -> None:
        # a numbered measure belongs to one place without naming it; the note's location written into the
        # question turned a correct answer about that place into a rejected one. prompt pin only: a mocked
        # LLM cannot prove prompt-following, behavioural coverage lives in the integration suite
        mock_invoke.return_value = HistoryAwareQuestionRewriterOutput(
            message="What is State Question 847?", reasoning="The question names its subject; no location added."
        )
        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="What is State Question 847?",
            history=[Message(role=Role.USER, content="Hi")],
            conversation_context=[ContextNote(id="1", text="Lives in Lagos")],
        )

        HistoryAwareQuestionRewriter().run(chat, Metadata())

        section = mock_invoke.call_args.args[-1]["user_notes_section"]
        assert "A question that names its own subject" in section
        assert "never add the location to it, even when it names no place" in section
        # the digest rule must not reclaim what the subject rule exempts ("give me an overview of Candidate X")
        assert "overview that names no place and no subject" in section

    @patch("langchain_core.runnables.base.RunnableSequence.invoke")
    def test_runs_with_notes_but_no_history(self, mock_invoke: MagicMock) -> None:
        mock_invoke.return_value = HistoryAwareQuestionRewriterOutput(
            message="When are the local elections in Lagos?",
            reasoning="The question depends on the user's location, which a note gives as Lagos.",
        )
        metadata = Metadata()
        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="When are the local elections?",
            history=None,
            conversation_context=[ContextNote(id="1", text="Lives in Lagos")],
        )

        result = HistoryAwareQuestionRewriter().run(chat, metadata)

        assert result.message == "When are the local elections in Lagos?"
        assert metadata.rewritten_question == "When are the local elections in Lagos?"
        assert mock_invoke.call_args.args[-1]["user_notes_section"]

    @patch("langchain_core.runnables.base.RunnableSequence.invoke")
    def test_empty_notes_add_no_section(self, mock_invoke: MagicMock) -> None:
        mock_invoke.return_value = HistoryAwareQuestionRewriterOutput(message="What is Python?", reasoning="Unchanged.")
        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="What is Python?",
            history=[Message(role=Role.USER, content="Hi")],
            conversation_context=[],
        )

        HistoryAwareQuestionRewriter().run(chat, Metadata())

        assert mock_invoke.call_args.args[-1]["user_notes_section"] == ""

    def test_no_history_and_empty_notes_returns_unchanged(self) -> None:
        chat = ChatRequest(hub_id=1, message_id=1, message="What is Python?", history=[], conversation_context=[])

        with patch("langchain_core.runnables.base.RunnableSequence.invoke") as mock_invoke:
            result = HistoryAwareQuestionRewriter().run(chat, Metadata())

        assert result == chat
        mock_invoke.assert_not_called()

    @patch("langchain_core.runnables.base.RunnableSequence.invoke")
    def test_prompt_keeps_the_group_qualifier_when_resolving_a_pronoun(self, mock_invoke: MagicMock) -> None:
        # guards the prompt rule: a pronoun resolved to a group keeps the place that defines the group.
        # a mocked LLM cannot prove prompt-following; only the rule text is checked.
        mock_invoke.return_value = HistoryAwareQuestionRewriterOutput(
            message="Tell me about the platforms of the candidates on the ballot in State A",
            reasoning="'their' resolved to the candidates the last message lists for the State A ballot.",
        )
        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="tell me about their platforms",
            history=[
                Message(role=Role.USER, content="who is on the ballot in State A"),
                Message(role=Role.ASSISTANT, content="In State A, the ballot includes Candidate X for governor."),
            ],
        )

        with patch("app.services.rewriter.PromptTemplate.from_template", wraps=PromptTemplate.from_template) as ft:
            HistoryAwareQuestionRewriter().run(chat, Metadata())

        template = ft.call_args.args[0]
        assert 'A generic descriptor keeps whatever "last_message" uses to define the group' in template
        assert "Pronoun Resolved to a Group (KEEP THE QUALIFIER)" in template
        assert "Which of the candidates for the council seat in Lagos" in template

    @patch("langchain_core.runnables.base.RunnableSequence.invoke")
    def test_prompt_carries_the_users_place_into_a_place_dependent_question(self, mock_invoke: MagicMock) -> None:
        # guards the rule that shared geography is a reason to enrich when the answer is set per place.
        # a mocked LLM cannot prove prompt-following; only the rule text is checked.
        mock_invoke.return_value = HistoryAwareQuestionRewriterOutput(
            message="How can I skip the lines at a polling place in California?",
            reasoning="How to avoid lines is set per state, so the place from the earlier turn was carried.",
        )
        chat = ChatRequest(
            hub_id=1,
            message_id=1,
            message="how can I skip the lines?",
            history=[
                Message(role=Role.USER, content="I vote in California, when is the registration deadline?"),
                Message(role=Role.ASSISTANT, content="In California, voters can register at their county office."),
            ],
            conversation_context=[ContextNote(id="1", text="Lives in California, United States")],
        )

        with patch("app.services.rewriter.PromptTemplate.from_template", wraps=PromptTemplate.from_template) as ft:
            HistoryAwareQuestionRewriter().run(chat, Metadata())

        template = ft.call_args.args[0]
        assert "NOT a reason to enrich when the answer is the same everywhere" in template
        assert "This is NOT the case for anything set per place" in template
        assert "Place-Dependent Question (CARRY THE USER'S PLACE)" in template
