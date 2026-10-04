"use client";
import { useId, useState } from "react";
import {
  validAccountEmail,
  validAccountPassword,
} from "./account-validation.js";

export function EmailField({
  label = "Email",
  disabled = false,
}: {
  label?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const invalid = touched && !validAccountEmail(value);
  return (
    <div className="account-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name="email"
        type="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        maxLength={254}
        disabled={disabled}
        value={value}
        aria-invalid={invalid}
        aria-describedby={invalid ? id + "-hint" : undefined}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          event.target.setCustomValidity(
            validAccountEmail(next) ? "" : "Enter a valid email address.",
          );
        }}
        onBlur={() => setTouched(true)}
      />
      {invalid && (
        <small id={id + "-hint"} className="warning">
          Enter a valid email address, such as name@example.com.
        </small>
      )}
    </div>
  );
}

export function PasswordField({
  label = "Password",
  newPassword = false,
  disabled = false,
}: {
  label?: string;
  newPassword?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const valid = validAccountPassword(value);
  return (
    <div className="account-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input">
        <input
          id={id}
          name="password"
          type={visible ? "text" : "password"}
          autoComplete={newPassword ? "new-password" : "current-password"}
          required
          minLength={12}
          maxLength={128}
          disabled={disabled}
          value={value}
          aria-describedby={id + "-hint"}
          aria-invalid={value.length > 0 && !valid}
          onChange={(event) => setValue(event.target.value)}
        />
        <button
          type="button"
          className="password-toggle"
          disabled={disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible(!visible)}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {visible && <path d="M3 3l18 18" />}
          </svg>
        </button>
      </div>
      <small id={id + "-hint"} aria-live="polite">
        {newPassword
          ? value.length === 0
            ? "Use 12 to 128 characters. A longer passphrase works well."
            : valid
              ? "Password length meets the requirement."
              : `${12 - value.length} more characters needed.`
          : "Use your account password, at least 12 characters."}
      </small>
    </div>
  );
}
