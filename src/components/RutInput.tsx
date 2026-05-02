import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatRUT, validateRUT } from "@/lib/rut";

export interface RutInputProps
  extends Omit<React.ComponentProps<"input">, "onChange" | "value" | "type"> {
  value: string;
  onChange: (formatted: string) => void;
  /** Show validation feedback. Defaults to true. */
  showFeedback?: boolean;
}

/**
 * Chilean RUT input with auto-formatting and on-blur validation.
 * - Stores the formatted value (e.g. "17086290-2").
 * - Shows green/red border + small message after the user leaves the field.
 */
export const RutInput = React.forwardRef<HTMLInputElement, RutInputProps>(
  ({ value, onChange, onBlur, className, showFeedback = true, ...rest }, ref) => {
    const [touched, setTouched] = React.useState(false);

    const isEmpty = !value || value.trim() === "";
    const isValid = !isEmpty && validateRUT(value);
    const showError = touched && !isEmpty && !isValid;
    const showOk = touched && !isEmpty && isValid;

    return (
      <div className="space-y-1">
        <Input
          ref={ref}
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder="12345678-9"
          maxLength={12}
          value={value}
          onChange={(e) => onChange(formatRUT(e.target.value))}
          onBlur={(e) => {
            setTouched(true);
            onBlur?.(e);
          }}
          aria-invalid={showError || undefined}
          className={cn(
            showError && "border-destructive focus-visible:ring-destructive",
            showOk && "border-emerald-500 focus-visible:ring-emerald-500",
            className,
          )}
          {...rest}
        />
        {showFeedback && showError && (
          <p className="text-xs text-destructive">✗ RUT inválido</p>
        )}
        {showFeedback && showOk && (
          <p className="text-xs text-emerald-600">✓ RUT válido</p>
        )}
      </div>
    );
  },
);
RutInput.displayName = "RutInput";
