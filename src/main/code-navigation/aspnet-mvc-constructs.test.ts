import { describe, expect, it } from 'vitest'
import { detectMvcConstruct } from './aspnet-mvc-constructs'

const VIEW = '/app/Views/Home/Index.cshtml'
const AREA_VIEW = '/app/Areas/Admin/Views/Users/List.cshtml'
const CONTROLLER = '/app/Controllers/HomeController.cs'

/** Detects at the `|` marker, which is removed from the text. */
function at(path: string, marked: string) {
  const offset = marked.indexOf('|')
  const text = marked.slice(0, offset) + marked.slice(offset + 1)
  const before = text.slice(0, offset).split('\n')
  return detectMvcConstruct(
    { path, text },
    { line: before.length - 1, character: before.at(-1)!.length }
  )
}

describe('detectMvcConstruct in views', () => {
  it('reads asp-action with its tag controller, or the view folder as controller', () => {
    expect(at(VIEW, '<a asp-controller="Account" asp-action="Log|in">x</a>')).toEqual({
      kind: 'action',
      action: 'Login',
      controller: 'Account',
      area: null
    })
    expect(at(VIEW, '<form asp-action="Cre|ate" method="post">')).toEqual({
      kind: 'action',
      action: 'Create',
      controller: 'Home',
      area: null
    })
    expect(at(AREA_VIEW, "<a asp-action='Ed|it'>x</a>")).toEqual({
      kind: 'action',
      action: 'Edit',
      controller: 'Users',
      area: 'Admin'
    })
  })

  it('reads asp-controller, spanning lines, with asp-area', () => {
    expect(
      at(VIEW, '<a asp-area="Shop"\n   asp-controller="Car|t"\n   asp-action="Index">cart</a>')
    ).toEqual({ kind: 'controller', controller: 'Cart', area: 'Shop' })
  })

  it('reads partial tag helpers, Html.Partial* helpers and Layout', () => {
    const view = (name: string) => ({
      kind: 'view',
      name,
      partial: true,
      context: { controller: 'Home', area: null, action: null }
    })
    expect(at(VIEW, '<partial name="_Login|Partial" />')).toEqual(view('_LoginPartial'))
    expect(at(VIEW, '@await Html.PartialAsync("_Na|v", Model)')).toEqual(view('_Nav'))
    expect(at(VIEW, '@{ Html.RenderPartial("_Fo|oter"); }')).toEqual(view('_Footer'))
    expect(at(VIEW, '@{\n    Layout = "_Lay|out";\n}')).toEqual(view('_Layout'))
  })

  it('reads routing helpers by argument position, skipping commas inside strings', () => {
    expect(at(VIEW, '@Html.ActionLink("Hi, you", "Abo|ut", "Home")')).toEqual({
      kind: 'action',
      action: 'About',
      controller: 'Home',
      area: null
    })
    expect(at(VIEW, '@Html.ActionLink("Hi", "About", "Acc|ount")')).toEqual({
      kind: 'controller',
      controller: 'Account',
      area: null
    })
    expect(at(VIEW, '<a href="@Url.Action("Detai|ls", new { id = 1 })">')).toEqual({
      kind: 'action',
      action: 'Details',
      controller: 'Home',
      area: null
    })
  })

  it('ignores ordinary strings, attributes and shared views without a controller', () => {
    expect(at(VIEW, '<a href="/abo|ut">x</a>')).toBeNull()
    expect(at(VIEW, '@{ ViewData["Tit|le"] = "Home"; }')).toBeNull()
    expect(at(VIEW, '<div class="na|v">')).toBeNull()
    expect(at('/app/Views/Shared/_Layout.cshtml', '<a asp-action="Ind|ex">x</a>')).toEqual({
      kind: 'action',
      action: 'Index',
      controller: null,
      area: null
    })
  })
})

describe('detectMvcConstruct in controllers', () => {
  const controller = (body: string) =>
    `namespace App.Controllers;\n\n[Area("Admin")]\npublic class HomeController : Controller\n{\n${body}\n}\n`

  it('maps View() to the enclosing action, honoring [ActionName]', () => {
    expect(
      at(
        CONTROLLER,
        controller('    public IActionResult Index()\n    {\n        return Vi|ew();\n    }')
      )
    ).toEqual({
      kind: 'view',
      name: null,
      partial: false,
      context: { controller: 'Home', area: 'Admin', action: 'Index' }
    })
    expect(
      at(
        CONTROLLER,
        controller(
          '    [HttpGet]\n    [ActionName("Show")]\n    public async Task<IActionResult> Details(int id)\n    {\n        return View|(model);\n    }'
        )
      )
    ).toMatchObject({ kind: 'view', name: null, context: { action: 'Show' } })
  })

  it('reads a named view from View(...) and PartialView(...), on the method or the name', () => {
    expect(
      at(
        CONTROLLER,
        controller('    public IActionResult A()\n    {\n        return View("Oth|er", m);\n    }')
      )
    ).toMatchObject({ kind: 'view', name: 'Other', partial: false })
    expect(
      at(
        CONTROLLER,
        controller(
          '    public IActionResult A()\n    {\n        return Partial|View("_Row");\n    }'
        )
      )
    ).toMatchObject({ kind: 'view', name: '_Row', partial: true })
  })

  it('reads RedirectToAction targets and leaves other calls alone', () => {
    expect(
      at(
        CONTROLLER,
        controller('    public IActionResult A() => RedirectToAction("Ind|ex", "Orders");')
      )
    ).toEqual({ kind: 'action', action: 'Index', controller: 'Orders', area: 'Admin' })
    expect(
      at(
        CONTROLLER,
        controller('    public IActionResult A() => RedirectToAction(nameof(Index), "Ord|ers");')
      )
    ).toEqual({ kind: 'controller', controller: 'Orders', area: 'Admin' })
    expect(at(CONTROLLER, controller('    public string A() => Format("Ind|ex");'))).toBeNull()
    expect(
      at(CONTROLLER, controller('    public IActionResult A() => RedirectToAction("A",| "B");'))
    ).toBeNull()
    expect(at(CONTROLLER, controller('    public object A() => model.Vi|ew();'))).toBeNull()
  })
})
