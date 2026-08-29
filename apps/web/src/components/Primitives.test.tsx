import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Modal } from "./Primitives";

function FocusHarness() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  return (
    <>
      <button onClick={() => setOpen(true)} type="button">Open dialog</button>
      <Modal onClose={() => setOpen(false)} open={open} title="Focused dialog">
        <label>
          Value
          <input
            aria-label="Dialog value"
            autoFocus
            data-autofocus
            onChange={(event) => setValue(event.target.value)}
            value={value}
          />
        </label>
      </Modal>
    </>
  );
}

function LatestEscapeHandlerHarness() {
  const [handlerVersion, setHandlerVersion] = useState("initial");
  const [closedWith, setClosedWith] = useState("not closed");

  return (
    <>
      <output aria-label="Close handler version">{closedWith}</output>
      <Modal onClose={() => setClosedWith(handlerVersion)} open title="Escape dialog">
        <button onClick={() => setHandlerVersion("latest")} type="button">Use latest close handler</button>
        <input aria-label="Escape dialog value" autoFocus data-autofocus />
      </Modal>
    </>
  );
}

afterEach(() => {
  cleanup();
});

describe("Modal", () => {
  it("prioritizes its autofocus field, keeps it focused while controlled state changes, and restores focus", async () => {
    const user = userEvent.setup();
    render(<FocusHarness />);

    const opener = screen.getByRole("button", { name: "Open dialog" });
    await user.click(opener);

    const input = screen.getByRole("textbox", { name: "Dialog value" });
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, "a continuous value");

    expect(input).toHaveValue("a continuous value");
    expect(input).toHaveFocus();
    expect(screen.getByRole("button", { name: "Close dialog" })).not.toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Close dialog" }));

    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("uses the latest close callback for Escape without restarting the dialog lifecycle", async () => {
    const user = userEvent.setup();
    render(<LatestEscapeHandlerHarness />);

    await user.click(screen.getByRole("button", { name: "Use latest close handler" }));
    await user.keyboard("{Escape}");

    expect(screen.getByLabelText("Close handler version")).toHaveTextContent("latest");
  });
});
