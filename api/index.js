import { Router } from "itty-router";
import words from "random-words";

const SYSTEM_PROMPT = (
  body
) => `Write JavaScript code that performs the user's instructions on the HTML described below.
Resp

Here are your rules:

- Respond only with a JavaScript code snippet formatted exactly like this:
\`\`\`js
// Your code here
\`\`\`
- Do not respond with HTML or CSS.
- Do not ask clarifying questions.

\`\`\`html
${body}
\`\`\``;

const EXAMPLE_COMMAND_1 = "Make the background red and the text white.";

const EXAMPLE_JAVASCRIPT_RESPONSE_1 = `\`\`\`js
document.body.style.backgroundColor = 'red';
document.body.style.color = 'white';
\`\`\``;

const EXAMPLE_COMMAND_2 =
  "Add a function that logs 'Hello world!' to the console.";

const EXAMPLE_JAVASCRIPT_RESPONSE_2 = `\`\`\`js
// Add a script tag to the document
const script = document.createElement('script');
document.body.appendChild(script);

// Add the function to the script tag
script.innerHTML = 'function sayHello() { console.log("Hello world!"); }';
\`\`\``;

const JS_MARKDOWN_REGEX = /```js\n([\s\S]*?)\n```/g;

const PAGES_REPO = "vinhowe/resite-pages";
const GITHUB_API_VERSION = "2022-11-28";

// Create a new router
const router = Router();

function githubHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_PAT}`,
    Accept: `application/vnd.github+json`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": "resite",
  };
}

function returnGithubError(error) {
  console.error(error);
  return new Response(
    JSON.stringify({
      error,
    }),
    {
      status: 500,
      headers: {
        "content-type": "application/json",
      },
    }
  );
}

function slugify(string) {
  return string
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

router.post("/upload", async (request, env, context) => {
  let { htmlBody, command, branch } = await request.json();

  // Get a reference to the head of the main branch
  const referenceResponse = await fetch(
    `https://api.github.com/repos/${PAGES_REPO}/git/ref/heads/${
      branch || "main"
    }`,
    { headers: githubHeaders(env) }
  );

  if (!referenceResponse.ok) {
    console.error(await referenceResponse.text());
    return returnGithubError("Could not get reference to main branch.");
  }

  const ref = (await referenceResponse.json()).object.sha;

  // Get the commit object
  const commitResponse = await fetch(
    `https://api.github.com/repos/${PAGES_REPO}/git/commits/${ref}`,
    { headers: githubHeaders(env) }
  );

  if (!commitResponse.ok) {
    console.error(await commitResponse.text());
    return returnGithubError("Could not get commit object.");
  }

  const commit = await commitResponse.json();

  // // Get the tree object
  // const treeResponse = await fetch(
  //   `https://api.github.com/repos/${PAGES_REPO}/git/trees/${commit.tree.sha}`,
  //   { headers: githubHeaders(env) }
  // );

  // if (!treeResponse.ok) {
  //   console.error(treeResponse);
  //   return returnGithubError("Could not get tree object.");
  // }

  // const tree = await treeResponse.json();

  // Create a new blob
  const blobResponse = await fetch(
    `https://api.github.com/repos/${PAGES_REPO}/git/blobs`,
    {
      method: "POST",
      headers: githubHeaders(env),
      body: JSON.stringify({
        content: htmlBody,
        encoding: "utf-8",
      }),
    }
  );

  if (!blobResponse.ok) {
    console.error(await blobResponse.text());
    return returnGithubError("Could not create new blob.");
  }

  const blob = await blobResponse.json();

  // Create a new tree with the new blob
  const newTreeResponse = await fetch(
    `https://api.github.com/repos/${PAGES_REPO}/git/trees`,
    {
      method: "POST",
      headers: githubHeaders(env),
      body: JSON.stringify({
        base_tree: commit.tree.sha,
        tree: [
          {
            path: `index.html`,
            mode: "100644",
            type: "blob",
            sha: blob.sha,
          },
        ],
      }),
    }
  );

  console.log(commit.sha)

  if (!newTreeResponse.ok) {
    console.error(await newTreeResponse.text());
    return returnGithubError("Could not create new tree.");
  }

  const newTree = await newTreeResponse.json();

  // Create a new commit
  const newCommitResponse = await fetch(
    `https://api.github.com/repos/${PAGES_REPO}/git/commits`,
    {
      method: "POST",
      headers: githubHeaders(env),
      body: JSON.stringify({
        message: command,
        parents: [commit.sha],
        tree: newTree.sha,
      }),
    }
  );

  if (!newCommitResponse.ok) {
    console.error(await newCommitResponse.text());
    return returnGithubError("Could not create new commit.");
  }

  const newCommit = await newCommitResponse.json();

  const branchName = `${slugify(command.slice(0, 40))}-${words({
    exactly: 2,
    join: "-",
  })}`;
  // Create a new branch
  const newBranchResponse = await fetch(
    `https://api.github.com/repos/${PAGES_REPO}/git/refs`,
    {
      method: "POST",
      headers: githubHeaders(env),
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: newCommit.sha,
      }),
    }
  );

  if (!newBranchResponse.ok) {
    console.error(await updateReferenceResponse.text());
    return returnGithubError("Could not create branch reference.");
  }

  // const updateReference = await updateReferenceResponse.json();

  return new Response(
    JSON.stringify({
      url: `https://raw.githubusercontent.com/${PAGES_REPO}/${branchName}/index.html`,
      ref: newCommit.sha,
      branch: branchName,
    }),
    {
      headers: {
        "content-type": "application/json",
      },
    }
  );
});

router.post("/command", async (request, env, context) => {
  const { htmlBody, command, history: requestHistory } = await request.json();

  let history = [];

  for (const item of requestHistory) {
    const { command, code } = item;
    // Command is user, code is assistant
    history.push({
      role: "user",
      content: command,
    });
    history.push({
      role: "assistant",
      content: `\`\`\`js\n${code}\n\`\`\``,
    });
  }

  const requestBody = JSON.stringify({
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT(htmlBody),
      },
      {
        role: "user",
        content: EXAMPLE_COMMAND_1,
      },
      {
        role: "assistant",
        content: EXAMPLE_JAVASCRIPT_RESPONSE_1,
      },
      {
        role: "user",
        content: EXAMPLE_COMMAND_2,
      },
      {
        role: "assistant",
        content: EXAMPLE_JAVASCRIPT_RESPONSE_2,
      },
      ...history,
      {
        role: "user",
        content: command,
      },
    ],
    model: "gpt-3.5-turbo",
    max_tokens: 2048,
    temperature: 0.7,
  });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_KEY}`,
    },
    body: requestBody,
  });

  // Get JSON response
  const json = await response.json();
  // Get the completion
  let completion = json.choices[0].message.content;
  // Use regex to get the JavaScript code
  const matches = completion.matchAll(JS_MARKDOWN_REGEX);

  console.log(completion);

  let code;
  // TODO: This is not good code
  if (matches) {
    // Just get the first match
    const match = matches.next().value;
    if (match) {
      code = match[1];
    }
  }

  if (!code) {
    // console.log("Couldn't find JavaScript code in response", completion);
    return new Response("Couldn't find JavaScript code in response", {
      status: 500,
    });
  }

  return new Response(JSON.stringify({ code, completion }));
});

// Generic options handler
router.options("/*", () => new Response(null, { status: 200 }));

export default {
  fetch: (request, env, context) =>
    router.handle(request, env, context).then((response) => {
      // Add CORS headers to the response
      response.headers.set("Access-Control-Allow-Origin", "*");
      response.headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
      );
      response.headers.set("Access-Control-Allow-Headers", "Content-Type");
      return response;
    }),
};
