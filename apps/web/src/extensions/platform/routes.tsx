import AccountOperations from "./AccountOperations";

export const industryRoutes = [
  {
    path: "/platform/account-operations",
    legacyPaths: ["/p32"],
    capabilityId: "platform.account-operations",
    element: <AccountOperations />,
  },
];
