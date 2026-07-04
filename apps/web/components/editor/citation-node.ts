import { Node, mergeAttributes } from "@tiptap/core";

export interface CitationOptions {
  // 快捷键只负责发起请求;UI(输入框/库搜索)在扩展外实现
  onRequestCitation?: () => void;
  // 视图层专用:citeKey 是否有效。仅影响 chip 外观,
  // 绝不写入 PM JSON / AST / HTML
  isCitationKnown?: (citeKey: string) => boolean;
  // 有效性来源变化时通知 NodeView 重算外观(返回取消订阅函数)。
  // 通用命名:extension 不感知"引用库"这一业务概念
  subscribeCitationValidity?: (onChange: () => void) => () => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (attrs: { citeKey: string }) => ReturnType;
    };
  }
}

// 只存 citeKey,不存渲染文本(Invariant #2)。[@citeKey] 是视图层派生。
export const Citation = Node.create<CitationOptions>({
  name: "citation",
  inline: true,
  atom: true,
  group: "inline",

  addOptions() {
    return {};
  },

  addAttributes() {
    return {
      // 无 default:citeKey 是必填 attr,缺失时 ProseMirror 拒绝创建节点
      citeKey: {
        parseHTML: (element) => element.getAttribute("data-cite-key"),
        renderHTML: (attributes) => ({ "data-cite-key": attributes.citeKey as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-cite-key]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes),
      `[@${node.attrs.citeKey as string}]`,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const citeKey = node.attrs.citeKey as string;
      const dom = document.createElement("span");
      dom.setAttribute("data-cite-key", citeKey);
      dom.contentEditable = "false";
      dom.className = "citation-chip";
      dom.textContent = `[@${citeKey}]`;

      const applyValidity = () => {
        const unknown =
          this.options.isCitationKnown !== undefined && !this.options.isCitationKnown(citeKey);
        dom.classList.toggle("citation-unknown", unknown);
        if (unknown) {
          dom.title = "引用库中不存在该文献";
          dom.setAttribute("aria-label", `未知引用 ${citeKey}`);
        } else {
          dom.removeAttribute("title");
          dom.removeAttribute("aria-label");
        }
      };
      applyValidity();
      const unsubscribe = this.options.subscribeCitationValidity?.(applyValidity);

      return { dom, destroy: () => unsubscribe?.() };
    };
  },

  addCommands() {
    return {
      insertCitation:
        ({ citeKey }) =>
        ({ commands }) => {
          const trimmed = citeKey.trim();
          if (trimmed.length === 0) return false;
          return commands.insertContent({ type: this.name, attrs: { citeKey: trimmed } });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-c": () => {
        if (!this.options.onRequestCitation) return false;
        this.options.onRequestCitation();
        return true;
      },
    };
  },
});
