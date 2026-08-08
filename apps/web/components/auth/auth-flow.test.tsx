// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticatedAppGate } from "./authenticated-app-gate";
import { LoginForm } from "./login-form";
import { useReferenceLibrary } from "@/stores/reference-library";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  signInEmail: vi.fn(),
  signOut: vi.fn(),
  useSession: vi.fn(),
  listReferences: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mocks.replace,
    refresh: mocks.refresh,
  }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: mocks.signInEmail },
    signOut: mocks.signOut,
    useSession: mocks.useSession,
  },
}));

vi.mock("@/lib/reference-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reference-client")>();
  return {
    ...actual,
    referenceClient: {
      ...actual.referenceClient,
      listReferences: mocks.listReferences,
    },
  };
});

describe("mentor authentication flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listReferences.mockResolvedValue([]);
    useReferenceLibrary.getState().clear();
    mocks.useSession.mockReturnValue({
      data: null,
      isPending: false,
      error: null,
    });
  });

  it("logs in and returns to the authenticated application", async () => {
    mocks.signInEmail.mockResolvedValue({ data: { token: null }, error: null });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "mentor@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(mocks.signInEmail).toHaveBeenCalledWith({
        email: "mentor@example.test",
        password: "correct-password",
        rememberMe: true,
      }),
    );
    expect(mocks.replace).toHaveBeenCalledWith("/");
  });

  it("shows a stable invalid-credential error", async () => {
    mocks.signInEmail.mockResolvedValue({
      data: null,
      error: { message: "Invalid email or password" },
    });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "mentor@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(mocks.replace).not.toHaveBeenCalledWith("/");
  });

  it("restores an authenticated session and its reference library after reload", async () => {
    mocks.useSession.mockReturnValue({
      data: {
        user: { id: "mentor-id", name: "Mentor", email: "mentor@example.test" },
        session: { id: "session-id" },
      },
      isPending: false,
      error: null,
    });
    render(
      <AuthenticatedAppGate>
        <p>Authenticated application</p>
      </AuthenticatedAppGate>,
    );
    expect(screen.getByText("Authenticated application")).toBeInTheDocument();
    await waitFor(() => expect(mocks.listReferences).toHaveBeenCalledTimes(1));
    expect(useReferenceLibrary.getState().activeUserId).toBe("mentor-id");
    expect(mocks.replace).not.toHaveBeenCalledWith("/login");
  });

  it("logs out and returns to the login gate", async () => {
    mocks.useSession.mockReturnValue({
      data: {
        user: { id: "mentor-id", name: "Mentor", email: "mentor@example.test" },
        session: { id: "session-id" },
      },
      isPending: false,
      error: null,
    });
    mocks.signOut.mockResolvedValue({ data: { success: true }, error: null });
    useReferenceLibrary.setState({
      items: [{ id: "persisted", type: "book", title: "Persisted" }],
      lastConfirmedItems: [{ id: "persisted", type: "book", title: "Persisted" }],
    });
    render(
      <AuthenticatedAppGate>
        <p>Authenticated application</p>
      </AuthenticatedAppGate>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    expect(useReferenceLibrary.getState().items).toEqual([]);
    expect(mocks.replace).toHaveBeenCalledWith("/login");
  });
});
