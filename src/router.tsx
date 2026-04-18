import ScenarioSelect from "./pages/ScenarioSelect";
import Simulator from "./pages/Simulator";
import NotFound from "./pages/NotFound";

export const routers = [
    {
      path: "/",
      name: 'home',
      element: <ScenarioSelect />,
    },
    {
      path: "/simulator/:scenarioId",
      name: 'simulator',
      element: <Simulator />,
    },
    /* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */
    {
      path: "*",
      name: '404',
      element: <NotFound />,
    },
];

declare global {
  interface Window {
    __routers__: typeof routers;
  }
}

window.__routers__ = routers;