import React from "react";
import { LinkIt, LinkItEmail } from "react-linkify-it";

import { urlRegex } from "@constants/regex";

type ParsedTextProps = {
  text: string;
};

const ParsedText = ({ text }: ParsedTextProps) => {
  if (!text) return null;

  const lines = text.split('\n');
  const spaced = lines.map((line, index) => (
    <React.Fragment key={index}>
      {index === 0 ? null : <br />}
      {line}
    </React.Fragment>
  ));

  return (
    <LinkItEmail>
      <LinkIt
        regex={urlRegex}
        component={(match, key) => (
        <a
          key={key}
          href={match.startsWith('http') ? match : `http://${match}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
        >
          {match}
        </a>
        )}
      >
        {spaced}
      </LinkIt>
    </LinkItEmail>
  );
};

export default ParsedText;