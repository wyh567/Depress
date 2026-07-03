import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import Heading from "@tiptap/extension-heading";
import Italic from "@tiptap/extension-italic";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";

// The ONLY extensions registered in the editor. Presentation marks/nodes
// (fontSize, color, fontFamily, textAlign, …) are enforced at the data
// layer by NOT registering them — the ProseMirror schema rejects them
// outright (Invariant #1). Do not add StarterKit.
export const depressExtensions = [
  Document,
  Paragraph,
  Text,
  Heading.configure({ levels: [1, 2, 3] }),
  Bold,
  Italic,
  UndoRedo,
];
