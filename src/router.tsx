import SynthwaveLanding from "./pages/SynthwaveLanding";
import ScenarioSelect from "./pages/ScenarioSelect";
import Simulator from "./pages/Simulator";
import WorkflowArchitect from "./pages/WorkflowArchitect";
import NotFound from "./pages/NotFound";

export const routers = [
    {
      path: "/",
      name: 'landing',
      element: <SynthwaveLanding />,
    },
    {
      path: "/app",
      name: 'home',
      element: <ScenarioSelect />,
    },
    {
      path: "/simulator/:scenarioId",
      name: 'simulator',
      element: <Simulator />,
    },
    {
      path: "/architect",
      name: 'architect',
      element: <WorkflowArchitect />,
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