import { resolveEnvelopeIcon } from "../lib/envelope-icons";
export default function EnvelopeIcon({
  name,
  size = 19,
}: {
  name?: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className="phosphor-envelope-icon"
      style={{ fontSize: `${size / 14}rem` }}
    >
      {String.fromCodePoint(resolveEnvelopeIcon(name).codepoint)}
    </span>
  );
}
