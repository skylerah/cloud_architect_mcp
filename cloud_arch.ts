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

class AzureArchitectureAdvisor {
  private questionHistory: ArchitectureInquiryData[] = [];
  private followUpQuestions: Record<number, ArchitectureInquiryData[]> = {};

  private validateInquiryData(input: unknown): ArchitectureInquiryData {
    const data = input as Record<string, unknown>;

    if (!data.question || typeof data.question !== 'string') {
      throw new Error('Invalid question: must be a string');
    }
    if (!data.questionNumber || typeof data.questionNumber !== 'number') {
      throw new Error('Invalid questionNumber: must be a number');
    }
    if (!data.totalQuestions || typeof data.totalQuestions !== 'number') {
      throw new Error('Invalid totalQuestions: must be a number');
    }
    if (typeof data.nextQuestionNeeded !== 'boolean') {
      throw new Error('Invalid nextQuestionNeeded: must be a boolean');
    }

    return {
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
  }

  private formatInquiry(inquiryData: ArchitectureInquiryData): string {
    const { 
      questionNumber, 
      totalQuestions, 
      question, 
      answer, 
      requirementCategory, 
      isFollowUp, 
      followsQuestionNumber,
      architectureSuggested,
      architectureComponent,
      detailLevel,
      requirementIdentified,
      technicalConstraint,
      designPatternSuggested,
      serviceDetails,
      architectureTier
    } = inquiryData;

    let prefix = '';
    let context = '';
    let additionalInfo: string[] = [];

    if (isFollowUp) {
      prefix = chalk.yellow('🔍 Follow-up');
      context = ` (follows question ${followsQuestionNumber})`;
    } else if (architectureSuggested) {
      prefix = chalk.green('🏗️ Architecture');
      const tierInfo = architectureTier ? ` in ${architectureTier} tier` : '';
      context = ` (suggesting component: ${architectureComponent}${tierInfo})`;
    } else {
      prefix = chalk.blue('❓ Question');
      context = requirementCategory ? ` (${requirementCategory})` : '';
    }

    if (detailLevel) {
      additionalInfo.push(chalk.cyan(`Detail level: ${detailLevel.toUpperCase()}`));
    }

    if (requirementIdentified) {
      additionalInfo.push(chalk.green(`Requirement: ${requirementIdentified}`));
    }

    if (technicalConstraint) {
      additionalInfo.push(chalk.red(`Constraint: ${technicalConstraint}`));
    }

    if (designPatternSuggested) {
      additionalInfo.push(chalk.magenta(`Design pattern: ${designPatternSuggested}`));
    }

    if (serviceDetails) {
      additionalInfo.push(chalk.blue(`Service: ${serviceDetails.name}`));
      additionalInfo.push(chalk.blue(`Purpose: ${serviceDetails.purpose}`));
      
      if (serviceDetails.configuration) {
        additionalInfo.push(chalk.blue(`Configuration: ${serviceDetails.configuration}`));
      }
      
      if (serviceDetails.alternatives && serviceDetails.alternatives.length > 0) {
        additionalInfo.push(chalk.blue(`Alternatives: ${serviceDetails.alternatives.join(', ')}`));
      }
    }

    const header = `${prefix} ${questionNumber}/${totalQuestions}${context}`;
    const questionText = `Q: ${question}`;
    const answerText = answer ? `A: ${answer}` : '(Awaiting user response)';
    
    // Find the longest line among all the content
    const allLines = [
      header, 
      questionText, 
      answerText,
      ...additionalInfo
    ];
    const longestLine = Math.max(...allLines.map(line => line.length));
    const border = '─'.repeat(longestLine + 4);

    let output = `
┌${border}┐
│ ${header.padEnd(longestLine)} │
├${border}┤
│ ${questionText.padEnd(longestLine)} │`;

    if (answer) {
      output += `\n│ ${answerText.padEnd(longestLine)} │`;
    }

    if (additionalInfo.length > 0) {
      output += `\n├${border}┤`;
      additionalInfo.forEach(info => {
        output += `\n│ ${info.padEnd(longestLine)} │`;
      });
    }

    output += `\n└${border}┘`;
    return output;
  }

  private architectureComponents: Set<string> = new Set();
  private identifiedRequirements: Set<string> = new Set();
  private technicalConstraints: Set<string> = new Set();
  private designPatterns: Set<string> = new Set();
  private serviceTiers: Record<string, Set<string>> = {
    'infrastructure': new Set(),
    'platform': new Set(), 
    'application': new Set(),
    'data': new Set(),
    'security': new Set(),
    'operations': new Set()
  };

  public processInquiry(input: unknown): { content: Array<{ type: string; text: string }>; isError?: boolean } {
    try {
      const validatedInput = this.validateInquiryData(input);

      if (validatedInput.questionNumber > validatedInput.totalQuestions) {
        validatedInput.totalQuestions = validatedInput.questionNumber;
      }

      // Track architecture components and requirements
      if (validatedInput.architectureComponent) {
        this.architectureComponents.add(validatedInput.architectureComponent);
      }
      
      if (validatedInput.requirementIdentified) {
        this.identifiedRequirements.add(validatedInput.requirementIdentified);
      }
      
      if (validatedInput.technicalConstraint) {
        this.technicalConstraints.add(validatedInput.technicalConstraint);
      }
      
      if (validatedInput.designPatternSuggested) {
        this.designPatterns.add(validatedInput.designPatternSuggested);
      }
      
      if (validatedInput.architectureTier && validatedInput.architectureComponent) {
        this.serviceTiers[validatedInput.architectureTier].add(validatedInput.architectureComponent);
      }

      this.questionHistory.push(validatedInput);

      if (validatedInput.isFollowUp && validatedInput.followsQuestionNumber) {
        if (!this.followUpQuestions[validatedInput.followsQuestionNumber]) {
          this.followUpQuestions[validatedInput.followsQuestionNumber] = [];
        }
        this.followUpQuestions[validatedInput.followsQuestionNumber].push(validatedInput);
      }

      const formattedInquiry = this.formatInquiry(validatedInput);
      console.error(formattedInquiry);

      // Calculate architecture completeness
      const tierCompleteness = Object.entries(this.serviceTiers).map(([tier, components]) => {
        return {
          tier,
          componentCount: components.size,
          hasComponents: components.size > 0
        };
      });
      
      const emptyTiers = tierCompleteness.filter(t => !t.hasComponents).map(t => t.tier);
      const architectureCompletenessPct = 
        (tierCompleteness.filter(t => t.hasComponents).length / Object.keys(this.serviceTiers).length) * 100;

      // Create a clean question text for the LLM to display directly
      let displayText = validatedInput.question;
      
      // Only add prefix for follow-up questions to make the transition smoother
      if (validatedInput.isFollowUp) {
        displayText = displayText.trim();
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            display_text: displayText,
            questionNumber: validatedInput.questionNumber,
            totalQuestions: validatedInput.totalQuestions,
            nextQuestionNeeded: validatedInput.nextQuestionNeeded,
            followUpQuestions: Object.keys(this.followUpQuestions).map(Number),
            questionHistoryLength: this.questionHistory.length,
            architectureStatus: {
              componentsCount: this.architectureComponents.size,
              requirementsCount: this.identifiedRequirements.size,
              constraintsCount: this.technicalConstraints.size,
              designPatternsCount: this.designPatterns.size,
              completenessPercentage: Math.round(architectureCompletenessPct),
              emptyTiers: emptyTiers,
              tierComponentCounts: Object.fromEntries(
                Object.entries(this.serviceTiers).map(([tier, components]) => [tier, components.size])
              )
            }
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
      }
    },
    required: ["question", "questionNumber", "totalQuestions", "nextQuestionNeeded"]
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

const architectureAdvisor = new AzureArchitectureAdvisor();

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [AZURE_ARCHITECTURE_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "design_azure_architecture") {
    return architectureAdvisor.processInquiry(request.params.arguments);
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