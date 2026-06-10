import { createBrowserRouter, RouterProvider } from "react-router";
import SessionsPage from "./pages/SessionsPage";
import SessionDetailPage from "./pages/SessionDetailPage";
import MemoriesPage from "./pages/MemoriesPage";
import RulesPage from "./pages/RulesPage";

const router = createBrowserRouter([
  { path: "/", element: <SessionsPage /> },
  { path: "/sessions/:id", element: <SessionDetailPage /> },
  { path: "/memories", element: <MemoriesPage /> },
  { path: "/rules", element: <RulesPage /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
