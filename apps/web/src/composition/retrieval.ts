import type { PublicConfig } from "@y7-feedback/config/public";

import { createHttpAccountlessGateway } from "../AccountlessHttpGateway";
import type { AppProps } from "../App";
import { createHttpConversationGateway } from "../ConversationGateway";
import { createHttpPrivacyGateway } from "../PrivacyGateway";
import { createHttpPublicationConsentGateway } from "../PublicationConsentGateway";

export function composeRetrieval(config: PublicConfig): AppProps {
  return {
    accountlessGateway: createHttpAccountlessGateway(config.apiEndpoint),
    conversationGateway: createHttpConversationGateway(config.apiEndpoint),
    privacyGateway: createHttpPrivacyGateway(config.apiEndpoint),
    publicationConsentGateway: createHttpPublicationConsentGateway(config.apiEndpoint),
  };
}
