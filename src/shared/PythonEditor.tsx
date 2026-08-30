import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';

// Thin, controlled wrapper -- @uiw/react-codemirror + @codemirror/lang-python
// chosen over Monaco specifically for weight (~50kB tree-shaken vs Monaco's
// full VS Code engine), matching this project's repeated preference for the
// lighter option.
export function PythonEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={[python()]}
      readOnly={readOnly}
      height="240px"
      className="python-editor"
      basicSetup={{ lineNumbers: true, foldGutter: false }}
    />
  );
}
