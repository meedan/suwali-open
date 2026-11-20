import type { Message } from "@customTypes/message";

import ParsedText from "@ui-components/layout/ParsedText";

type NodeQuoteProps = {
  body: Message['body'];
};

// Renders nothing for an empty body rather than an empty quote bar
const NodeQuote = ({ body }: NodeQuoteProps) => {
  if (!body) return null;

  return (
    <blockquote>
      <p>
        <ParsedText text={body} />
      </p>
    </blockquote>
  );
};

export default NodeQuote;
