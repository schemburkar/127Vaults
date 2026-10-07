import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./button";

export type GeneratorOptions = {
  mode: "password" | "passphrase" | "pin";
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
  words: number;
  separator: string;
  capitalize: boolean;
  appendNumber: boolean;
};

const defaults: GeneratorOptions = {
  mode: "password",
  length: 20,
  lowercase: true,
  uppercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
  words: 6,
  separator: " ",
  capitalize: false,
  appendNumber: false,
};

export function SecretGenerator({
  generate,
  onUse,
  label = "password",
  initialMode = "password",
}: {
  generate: (options: GeneratorOptions) => Promise<string>;
  onUse: (value: string) => void;
  label?: string;
  initialMode?: GeneratorOptions["mode"];
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState(defaults);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [customSeparator, setCustomSeparator] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const revision = useRef(0);
  const titleId = useId();
  const helpId = useId();
  const close = () => {
    revision.current++;
    setValue("");
    setError("");
    setBusy(false);
    setRevealed(false);
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const dismiss = () => close();
    window.addEventListener("vaults:clear-generator", dismiss);
    return () => {
      revision.current++;
      window.removeEventListener("vaults:clear-generator", dismiss);
      queueMicrotask(() => {
        if (
          trigger.current?.isConnected &&
          trigger.current.getClientRects().length
        )
          trigger.current.focus();
      });
    };
  }, [open]);
  const patch = (change: Partial<GeneratorOptions>) => {
    revision.current++;
    setOptions((current) => ({ ...current, ...change }));
    setValue("");
    setError("");
    setBusy(false);
  };
  const run = async () => {
    const request = ++revision.current;
    setBusy(true);
    setValue("");
    setError("");
    try {
      const result = await generate(options);
      if (revision.current === request) setValue(result);
    } catch (reason) {
      if (revision.current === request)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (revision.current === request) setBusy(false);
    }
  };
  const control =
    "min-h-11 rounded-xl border border-white/20 bg-[#11162b] px-3 py-2 text-sm text-white";
  const check = (
    key:
      | "lowercase"
      | "uppercase"
      | "numbers"
      | "symbols"
      | "excludeAmbiguous"
      | "capitalize"
      | "appendNumber",
    text: string,
  ) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={options[key]}
        onChange={(event) => patch({ [key]: event.target.checked })}
      />
      {text}
    </label>
  );
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        aria-label={`Generate ${label}`}
        onClick={(event) => {
          trigger.current = event.currentTarget;
          setOptions({
            ...defaults,
            mode: initialMode,
            length: initialMode === "pin" ? 6 : 20,
          });
          setCustomSeparator(false);
          setOpen(true);
        }}
      >
        Generate
      </Button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            aria-labelledby={titleId}
            aria-describedby={helpId}
            onCancel={(event) => {
              event.preventDefault();
              close();
            }}
            onClose={close}
            className="fixed inset-0 m-auto max-h-[90dvh] w-[min(30rem,calc(100vw-2rem))] overflow-auto rounded-2xl border border-white/20 bg-[#11162b] p-6 text-slate-100 shadow-2xl backdrop:bg-black/70"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id={titleId} className="text-xl font-bold">
                Generate {label}
              </h2>
              <Button type="button" variant="ghost" onClick={close}>
                Close
              </Button>
            </div>
            <p id={helpId} className="mt-2 text-sm text-slate-400">
              Generated securely on this device. Use it when you are ready.
            </p>
            <div className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm">
                Type
                <select
                  autoFocus
                  className={control}
                  value={options.mode}
                  onChange={(event) => {
                    const mode = event.target.value as GeneratorOptions["mode"];
                    patch({ mode, length: mode === "pin" ? 6 : 20 });
                  }}
                >
                  <option value="password">Random password</option>
                  <option value="passphrase">Passphrase</option>
                  <option value="pin">PIN</option>
                </select>
              </label>
              {options.mode !== "passphrase" && (
                <label className="grid gap-2 text-sm">
                  {options.mode === "pin" ? "Digits" : "Length"}
                  <input
                    className={control}
                    type="number"
                    min={4}
                    max={options.mode === "pin" ? 32 : 128}
                    value={options.length}
                    onChange={(event) =>
                      patch({ length: Number(event.target.value) })
                    }
                  />
                </label>
              )}
              {options.mode === "password" && (
                <fieldset className="grid grid-cols-2 gap-3">
                  <legend className="mb-2 text-sm text-slate-400">
                    Include at least one of each selected set
                  </legend>
                  {check("lowercase", "Lowercase (a–z)")}
                  {check("uppercase", "Uppercase (A–Z)")}
                  {check("numbers", "Numbers (0–9)")}
                  {check("symbols", "Symbols")}
                  {check("excludeAmbiguous", "Exclude Il1O0o")}
                </fieldset>
              )}
              {options.mode === "passphrase" && (
                <>
                  <label className="grid gap-2 text-sm">
                    Words
                    <input
                      className={control}
                      type="number"
                      min={3}
                      max={20}
                      value={options.words}
                      onChange={(event) =>
                        patch({ words: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label className="grid gap-2 text-sm">
                    Separator
                    <select
                      className={control}
                      value={customSeparator ? "custom" : options.separator}
                      onChange={(event) => {
                        setCustomSeparator(event.target.value === "custom");
                        patch({
                          separator:
                            event.target.value === "custom"
                              ? "/"
                              : event.target.value,
                        });
                      }}
                    >
                      <option value=" ">Space</option>
                      <option value="-">Hyphen (-)</option>
                      <option value="_">Underscore (_)</option>
                      <option value=".">Period (.)</option>
                      <option value="">None</option>
                      <option value="custom">Custom</option>
                    </select>
                  </label>
                  {customSeparator && (
                    <label className="grid gap-2 text-sm">
                      Custom separator
                      <input
                        className={control}
                        maxLength={8}
                        value={options.separator}
                        onChange={(event) =>
                          patch({ separator: event.target.value })
                        }
                      />
                    </label>
                  )}
                  {check("capitalize", "Capitalize each word")}
                  {check("appendNumber", "Append a random digit")}
                </>
              )}
              {options.mode === "pin" && (
                <p className="text-sm text-amber-200">
                  Short PINs have limited strength. Use them where a numeric
                  code is required.
                </p>
              )}
              {options.mode === "passphrase" && (
                <p className="text-xs text-slate-400">
                  Each word is selected independently from 7,776 words.
                </p>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void run()}
              >
                {busy ? "Generating…" : value ? "Regenerate" : "Generate"}
              </Button>
              {error && (
                <p role="alert" className="text-sm text-red-300">
                  {error}
                </p>
              )}
              {value && (
                <>
                  <label className="grid gap-2 text-sm">
                    Generated value
                    <input
                      className={`${control} font-mono`}
                      readOnly
                      type={revealed ? "text" : "password"}
                      value={value}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setRevealed((current) => !current)}
                  >
                    {revealed ? "Hide" : "Reveal"}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      onUse(value);
                      close();
                    }}
                  >
                    Use {options.mode === "pin" ? "PIN" : options.mode}
                  </Button>
                </>
              )}
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
