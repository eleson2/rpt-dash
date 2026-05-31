import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

/** Login screen; switches to first-admin setup when the server has no users. */
export function Login({ needsBootstrap }: { needsBootstrap: boolean }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = useMutation({
    mutationFn: () =>
      needsBootstrap ? api.register(username, password) : api.login(username, password),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth"] }),
  });

  return (
    <div className="login-wrap">
      <form
        className="card login-card"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        <div className="brand">rpt-dash</div>
        <h2>{needsBootstrap ? "Create the first admin" : "Sign in"}</h2>
        {needsBootstrap && (
          <p className="muted">No users exist yet. This account will be the administrator.</p>
        )}
        <label className="block">
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label className="block">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {needsBootstrap && <div className="muted small">Password must be at least 8 characters.</div>}
        <button type="submit" disabled={!username || !password || submit.isPending}>
          {submit.isPending ? "…" : needsBootstrap ? "Create admin" : "Sign in"}
        </button>
        {submit.isError && <div className="error">{(submit.error as Error).message}</div>}
      </form>
    </div>
  );
}
