#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { Request, Response } from "express";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
// Fixed chalk import for ESM
import chalk from 'chalk';

// Add cors import
import cors from 'cors';

interface ArchitectureInquiryData {
  question: string;
  questionNumber: number;
  totalQuestions: number;
  answer?: string;
  nextQuestionNeeded: boolean;
  requirementCategory?: string;
  isFollowUp?: boolean;
  followsQuestionNumber?: number;
  architectureSuggested?: boolean;
  architectureComponent?: string;
  detailLevel?: 'high' | 'medium' | 'low';
  domainSpecific?: boolean;
  requirementIdentified?: string;
  technicalConstraint?: string;
  designPatternSuggested?: string;
  serviceDetails?: {
    name: string;
    purpose: string;
    configuration?: string;
    alternatives?: string[];
  };
  architectureTier?: 'infrastructure' | 'platform' | 'application' | 'data' | 'security' | 'operations';
}

interface ArchitectureState {
  questionHistory: ArchitectureInquiryData[];
  followUpQuestions: Record<string, ArchitectureInquiryData[]>;
  architectureComponents: string[];
  identifiedRequirements: string[];
  technicalConstraints: string[];
  designPatterns: string[];
  serviceTiers: Record<string, string[]>;
  calculatedMetrics?: {
    emptyTiers: string[];
    completenessPercentage: number;
    tierComponentCounts: Record<string, number>;
  };
  display?: {
    displayText: string;
  };
}

const AZURE_ARCHITECTURE_TOOL: Tool = {
  name: "design_azure_architecture",
  description: `A comprehensive tool for designing detailed Azure cloud architectures through an iterative questioning process.
This tool helps determine the optimal Azure architecture for a client by asking targeted questions
to understand requirements, constraints, and goals. It empowers the AI to act as a Senior Azure Solutions
Architect who leads a thorough requirements gathering session and designs enterprise-grade cloud architectures.

When to use this tool:
- Gathering detailed cloud architecture requirements systematically
- Designing comprehensive Azure-based solutions with multiple tiers and components
- Helping users clarify their cloud requirements and constraints
- Determining the appropriate Azure services with specific configuration recommendations
- Facilitating architectural decision-making with design patterns and best practices
- Ensuring all architecture tiers are properly addressed

Key features:
- You can adjust total_questions up or down as you learn more about the client needs
- You can ask targeted follow-up questions based on previous answers
- You can identify specific requirements and technical constraints
- You can suggest detailed architecture components with configuration recommendations
- You can track different tiers of architecture (infrastructure, platform, application, data, security, operations)
- You can recommend specific design patterns and architectural approaches
- You can provide comprehensive architecture designs with alternatives and trade-offs

Parameters explained:
- question: The current question being asked to gather requirements or clarify information
- questionNumber: Current number in sequence (can go beyond initial total if needed)
- totalQuestions: Current estimate of questions needed (can be adjusted up/down)
- answer: The user's response to the question (if available)
- nextQuestionNeeded: True if more questions are needed to complete the architecture design
- requirementCategory: Category for organizing requirements (e.g. "security", "performance", "cost")
- isFollowUp: Boolean indicating if this question follows up on a previous question
- followsQuestionNumber: If isFollowUp is true, which question number this follows
- architectureSuggested: Boolean indicating if this message suggests an architecture component
- architectureComponent: If architectureSuggested is true, the specific Azure component being suggested
- detailLevel: Indicates depth of detail for the component ('high', 'medium', 'low')
- domainSpecific: Boolean indicating if this is a domain-specific question/component
- requirementIdentified: Specific requirement identified from user responses
- technicalConstraint: Technical constraint identified that impacts architecture
- designPatternSuggested: Architectural pattern being recommended
- serviceDetails: Detailed information about a specific Azure service
- architectureTier: Which architectural tier this component belongs to
- state: Complete architecture state to maintain statelessness on the server

100% CLIENT-MANAGED SYSTEM:
- The entire architecture state is managed by YOU (the client AI)
- The server performs NO calculations, modifications, or processing of your data
- YOU are responsible for all state updates, calculations, and text formatting
- YOU must track all components, requirements, constraints, etc.
- YOU must calculate all metrics (completeness, empty tiers, component counts, etc.)
- YOU must format any text for display

Required state structure:
{
  "questionHistory": [], // Array of all previous questions and answers
  "followUpQuestions": {}, // Object with question numbers as keys and arrays of follow-up questions as values
  "architectureComponents": [], // Array of all Azure components suggested
  "identifiedRequirements": [], // Array of all requirements identified
  "technicalConstraints": [], // Array of all constraints identified
  "designPatterns": [], // Array of all design patterns suggested
  "serviceTiers": { // Object with arrays of components for each tier
    "infrastructure": [],
    "platform": [],
    "application": [],
    "data": [],
    "security": [],
    "operations": []
  },
  "calculatedMetrics": { // All metrics must be calculated by YOU
    "emptyTiers": [], // Array of tier names that have no components
    "completenessPercentage": 0, // Percentage of tiers that have at least one component
    "tierComponentCounts": {} // Object with the count of components for each tier
  },
  "display": { // Display formatting must be done by YOU
    "displayText": "" // The formatted question text for display
  }
}

IMPORTANT: You must initialize this state structure on the first call and maintain it across calls.
For the first call, create an empty structure following the format above.
For subsequent calls, use the state returned from the previous call and UPDATE IT based on the current input.

State update rules:
1. If the current input has architectureComponent, add it to state.architectureComponents (if not already there)
2. If the current input has requirementIdentified, add it to state.identifiedRequirements (if not already there)
3. If the current input has technicalConstraint, add it to state.technicalConstraints (if not already there)
4. If the current input has designPatternSuggested, add it to state.designPatterns (if not already there)
5. If the current input has architectureTier and architectureComponent, add the component to state.serviceTiers[architectureTier]
6. Always add the current input to state.questionHistory
7. If the current input is a follow-up question (isFollowUp=true), add it to state.followUpQuestions[followsQuestionNumber]
8. If questionNumber > totalQuestions, update totalQuestions to equal questionNumber in your response

Metric calculation rules (YOU MUST perform these calculations):
1. For each tier, count the number of components and store in state.calculatedMetrics.tierComponentCounts
2. Check which tiers have zero components and add them to state.calculatedMetrics.emptyTiers
3. Calculate completeness percentage: (number of non-empty tiers / total number of tiers) * 100
4. Round the completeness percentage to a whole number
5. Set state.display.displayText to the current question. If it's a follow-up question, trim any leading/trailing whitespace

Processing logic:
- Track architecture components and requirements in appropriate categories
- Maintain question history and follow-up questions
- Calculate architecture completeness across all tiers
- Return formatted response with status and metrics

You should:
1. Start with high-level questions about business goals and requirements
2. Ask specific technical questions based on previous answers, going into details
3. Adapt further questions based on user responses
4. Identify specific requirements and technical constraints from user responses
5. Explore all important architecture tiers: infrastructure, platform, application, data, security, operations
6. Suggest specific Azure services with detailed configuration options and alternatives
7. Recommend appropriate design patterns for the architecture
8. Ensure comprehensive coverage of all architecture tiers
9. Only set nextQuestionNeeded to false when a complete, detailed architecture is designed
10. Focus on creating detailed, production-ready architecture designs that address all concerns
11. Track the completeness of the architecture design using the metrics provided in the response
12. Identify gaps in the architecture design and ask questions to fill those gaps
13. Follow Azure Well-Architected Framework principles (reliability, security, cost, operational excellence, performance efficiency)`,
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The current question being asked"
      },
      questionNumber: {
        type: "integer",
        description: "Current question number",
        minimum: 1
      },
      totalQuestions: {
        type: "integer",
        description: "Estimated total questions needed",
        minimum: 1
      },
      answer: {
        type: "string",
        description: "The user's response to the question"
      },
      nextQuestionNeeded: {
        type: "boolean",
        description: "Whether another question is needed"
      },
      requirementCategory: {
        type: "string",
        description: "Category for organizing requirements"
      },
      isFollowUp: {
        type: "boolean",
        description: "Whether this is a follow-up to a previous question"
      },
      followsQuestionNumber: {
        type: "integer",
        description: "Question number this follows up on",
        minimum: 1
      },
      architectureSuggested: {
        type: "boolean",
        description: "Whether this suggests an architecture component"
      },
      architectureComponent: {
        type: "string",
        description: "Specific Azure component being suggested"
      },
      detailLevel: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "Level of detail for this component or question"
      },
      domainSpecific: {
        type: "boolean",
        description: "Whether this relates to a specific domain (e.g., healthcare, finance)"
      },
      requirementIdentified: {
        type: "string",
        description: "Specific requirement identified from user responses"
      },
      technicalConstraint: {
        type: "string",
        description: "Technical constraint identified that impacts architecture"
      },
      designPatternSuggested: {
        type: "string",
        description: "Architectural pattern being recommended"
      },
      serviceDetails: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Name of the Azure service"
          },
          purpose: {
            type: "string",
            description: "Purpose of this service in the architecture"
          },
          configuration: {
            type: "string",
            description: "Recommended configuration details"
          },
          alternatives: {
            type: "array",
            items: {
              type: "string"
            },
            description: "Alternative Azure services that could be used"
          }
        },
        required: ["name", "purpose"],
        description: "Detailed information about a specific Azure service"
      },
      architectureTier: {
        type: "string",
        enum: ["infrastructure", "platform", "application", "data", "security", "operations"],
        description: "Which architectural tier this component belongs to"
      },
      state: {
        type: "object",
        description: "The complete architecture state from the previous request",
        properties: {
          questionHistory: {
            type: "array",
            description: "Complete history of all questions asked",
            items: {
              type: "object"
            }
          },
          followUpQuestions: {
            type: "object",
            description: "Record of all follow-up questions by question number"
          },
          architectureComponents: {
            type: "array",
            description: "All architecture components suggested so far",
            items: {
              type: "string"
            }
          },
          identifiedRequirements: {
            type: "array",
            description: "All requirements identified so far",
            items: {
              type: "string"
            }
          },
          technicalConstraints: {
            type: "array",
            description: "All technical constraints identified so far",
            items: {
              type: "string"
            }
          },
          designPatterns: {
            type: "array",
            description: "All design patterns suggested so far",
            items: {
              type: "string"
            }
          },
          serviceTiers: {
            type: "object",
            description: "Components organized by architecture tier",
            additionalProperties: {
              type: "array",
              items: {
                type: "string"
              }
            }
          },
          calculatedMetrics: {
            type: "object",
            description: "Calculated metrics for the architecture",
            properties: {
              emptyTiers: {
                type: "array",
                description: "Tiers with no components",
                items: {
                  type: "string"
                }
              },
              completenessPercentage: {
                type: "number",
                description: "Percentage of architecture completeness"
              },
              tierComponentCounts: {
                type: "object",
                description: "Count of components per tier"
              }
            }
          },
          display: {
            type: "object",
            description: "Display formatting for the architecture",
            properties: {
              displayText: {
                type: "string",
                description: "Formatted text for display"
              }
            }
          }
        }
      }
    },
    required: ["question", "questionNumber", "totalQuestions", "nextQuestionNeeded", "state"]
  }
};

const server = new Server(
  {
    name: "cloud-architect",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [AZURE_ARCHITECTURE_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "design_azure_architecture") {
    try {
      const data = request.params.arguments as Record<string, unknown>;
      
      const input = {
        question: data.question as string,
        questionNumber: data.questionNumber as number,
        totalQuestions: data.totalQuestions as number,
        nextQuestionNeeded: data.nextQuestionNeeded as boolean,
        answer: data.answer as string | undefined,
        requirementCategory: data.requirementCategory as string | undefined,
        isFollowUp: data.isFollowUp as boolean | undefined,
        followsQuestionNumber: data.followsQuestionNumber as number | undefined,
        architectureSuggested: data.architectureSuggested as boolean | undefined,
        architectureComponent: data.architectureComponent as string | undefined,
        detailLevel: data.detailLevel as 'high' | 'medium' | 'low' | undefined,
        domainSpecific: data.domainSpecific as boolean | undefined,
        requirementIdentified: data.requirementIdentified as string | undefined,
        technicalConstraint: data.technicalConstraint as string | undefined,
        designPatternSuggested: data.designPatternSuggested as string | undefined,
        serviceDetails: data.serviceDetails as {
          name: string;
          purpose: string;
          configuration?: string;
          alternatives?: string[];
        } | undefined,
        architectureTier: data.architectureTier as 'infrastructure' | 'platform' | 'application' | 'data' | 'security' | 'operations' | undefined,
      };

      // Get state from client - all management and calculations are done by the client
      const state = data.state as ArchitectureState;

      // Simply pass through the client's input and state with minimal processing
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            display_text: state.display?.displayText || input.question,
            questionNumber: input.questionNumber,
            totalQuestions: input.totalQuestions,
            nextQuestionNeeded: input.nextQuestionNeeded,
            followUpQuestions: Object.keys(state.followUpQuestions),
            questionHistoryLength: state.questionHistory.length,
            architectureStatus: {
              componentsCount: state.architectureComponents.length,
              requirementsCount: state.identifiedRequirements.length,
              constraintsCount: state.technicalConstraints.length,
              designPatternsCount: state.designPatterns.length,
              completenessPercentage: state.calculatedMetrics?.completenessPercentage || 0,
              emptyTiers: state.calculatedMetrics?.emptyTiers || [],
              tierComponentCounts: state.calculatedMetrics?.tierComponentCounts || {}
            },
            state: state // Pass the state back to client unchanged
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            status: 'failed'
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  return {
    content: [{
      type: "text",
      text: `Unknown tool: ${request.params.name}`
    }],
    isError: true
  };
});

async function runServer() {
  // Check if SSE transport is requested
  const useSSE = process.argv.includes('--sse');
  const port = parseInt(process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1] || '8000');
  
  if (useSSE) {
    const app = express();
    
    // Add CORS middleware
    app.use(cors());
    
    // Add basic error handling
    app.use((err: any, req: Request, res: Response, next: Function) => {
      console.error('Express error:', err);
      res.status(500).send('Internal Server Error');
    });
    
    // Add a health check endpoint
    app.get('/health', (_, res) => {
      res.status(200).send('Cloud Architect MCP Server is running');
    });
    
    // to support multiple simultaneous connections we have a lookup object from
    // sessionId to transport
    const transports: {[sessionId: string]: SSEServerTransport} = {};

    app.get("/sse", async (req: Request, res: Response) => {
      console.error(`SSE connection request received from ${req.ip}`);
      try {
        const transport = new SSEServerTransport('/messages', res);
        transports[transport.sessionId] = transport;
        res.on("close", () => {
          console.error(`SSE connection closed for session ${transport.sessionId}`);
          delete transports[transport.sessionId];
        });
        await server.connect(transport);
        console.error(`SSE connection established for session ${transport.sessionId}`);
      } catch (error) {
        console.error('Error establishing SSE connection:', error);
        res.status(500).send('Failed to establish SSE connection');
      }
    });

    app.post("/messages", async (req: Request, res: Response) => {
      const sessionId = req.query.sessionId as string;
      console.error(`Message received for session ${sessionId}`);
      const transport = transports[sessionId];
      if (transport) {
        try {
          await transport.handlePostMessage(req, res);
        } catch (error) {
          console.error(`Error handling message for session ${sessionId}:`, error);
          res.status(500).send('Error processing message');
        }
      } else {
        console.error(`No transport found for session ${sessionId}`);
        res.status(400).send('No transport found for sessionId');
      }
    });

    app.listen(port, () => {
      console.error(`Cloud Architect MCP Server running on SSE at http://localhost:${port}`);
      console.error(`To connect, use the /sse endpoint`);
      console.error(`Health check available at http://localhost:${port}/health`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Cloud Architect MCP Server running on stdio");
  }
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});