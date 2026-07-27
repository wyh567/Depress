import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section aria-labelledby="login-title" className="w-full max-w-sm">
        <h1 id="login-title" className="mb-6 text-2xl font-semibold">
          Mentor sign in
        </h1>
        <LoginForm />
      </section>
    </main>
  );
}
