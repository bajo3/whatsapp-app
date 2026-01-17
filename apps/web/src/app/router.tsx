
import { createBrowserRouter, redirect } from "react-router-dom";
import { RootLayout } from "./root-layout";
import { LoginPage } from "../pages/login";
import { InboxPage } from "../pages/inbox";
import { ContactsPage } from "../pages/contacts";
import { SettingsPage } from "../pages/settings";
import { requireSession } from "../lib/session";

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/",
    element: <RootLayout />,
    loader: async () => {
      const ok = await requireSession();
      if (!ok) throw redirect("/login");
      return null;
    },
    children: [
      { index: true, element: <InboxPage /> },
      { path: "contacts", element: <ContactsPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);
