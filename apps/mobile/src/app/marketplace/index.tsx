import { Redirect } from "expo-router";

/** The Marketplace is the third page of Explore now (app/housing.tsx): an old link to /marketplace (the website's address) lands on it. */
export default function MarketplaceRedirect() {
  return <Redirect href={{ pathname: "/housing", params: { section: "marketplace" } }} />;
}
